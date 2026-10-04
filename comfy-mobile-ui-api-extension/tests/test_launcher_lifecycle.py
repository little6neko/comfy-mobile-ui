"""Standalone launcher lifecycle tests; requires psutil and requests, not ComfyUI."""

import os
from pathlib import Path
import subprocess
import socket
import sys
import threading
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import psutil
from launcher_service import EnhancedExternalComfyUILauncher as Launcher, ThreadedHTTPServer
from http.server import BaseHTTPRequestHandler


class LauncherLifecycleTests(unittest.TestCase):
    def setUp(self):
        # Avoid config/log writes and starting the real application.
        self.launcher = Launcher.__new__(Launcher)
        self.launcher._stop_event = threading.Event()
        self.launcher._lifecycle_lock = threading.RLock()
        self.launcher._restarting = False
        self.launcher._shutdown_started = False
        self.launcher.is_running = True
        self.launcher._owner_process = psutil.Process(os.getpid())
        self.launcher.comfyui_process = None
        self.launcher.log = Mock()
        self.launcher.stop_api_server = Mock()

    def watch(self):
        thread = threading.Thread(target=self.launcher._watch_owner, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(self.launcher._stop_event.set)
        return thread

    def child(self):
        process = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
        def cleanup():
            if process.poll() is None:
                process.kill()
            process.wait(timeout=3)
        self.addCleanup(cleanup)
        return process

    def test_run_releases_http_port_after_owner_exit_with_idle_connection(self):
        child = self.child()
        launcher = self.launcher
        launcher._owner_process = psutil.Process(child.pid)
        server = ThreadedHTTPServer(('127.0.0.1', 0), BaseHTTPRequestHandler)
        self.addCleanup(server.server_close)
        launcher.api_server = server
        launcher.api_thread = threading.Thread(target=server.serve_forever, daemon=True)
        launcher.start_api_server = launcher.api_thread.start
        launcher.stop_api_server = lambda: Launcher.stop_api_server(launcher)
        launcher.comfyui_dir = '/unused'
        launcher.comfyui_port = 8188
        launcher.api_port = server.server_port
        launcher.check_interval = launcher.initial_check_interval = 30
        launcher.is_comfyui_responsive = Mock(return_value=False)
        runner = threading.Thread(target=launcher.run, daemon=True)
        self.addCleanup(runner.join, 3)
        self.addCleanup(launcher._stop_event.set)
        runner.start()
        # Simulate a browser holding an incomplete request open during shutdown.
        connection = socket.create_connection(server.server_address, timeout=2)
        self.addCleanup(connection.close)
        child.terminate()
        child.wait(timeout=3)
        runner.join(3)
        self.assertFalse(runner.is_alive())
        self.assertEqual(server.fileno(), -1)

    def test_discovery_matches_script_and_default_port(self):
        self.launcher.comfyui_args = ['/comfy/main.py']
        self.launcher.comfyui_port = 8188
        unrelated = Mock(info={'cmdline': ['python', '/other/main.py']})
        owner = Mock(info={'cmdline': ['python', 'main.py']})
        owner.cwd.return_value = '/comfy'
        with patch('launcher_service.psutil.process_iter', return_value=[unrelated, owner]):
            self.assertIs(self.launcher.find_comfyui_process(), owner)

    def test_owner_exit_stops_launcher_for_terminate_and_kill(self):
        for action in ('terminate', 'kill'):
            with self.subTest(action=action):
                self.launcher._stop_event.clear()
                self.launcher.is_running = True
                child = self.child()
                self.launcher._owner_process = psutil.Process(child.pid)
                watcher = self.watch()
                getattr(child, action)()
                child.wait(timeout=3)
                self.assertTrue(self.launcher._stop_event.wait(2))
                watcher.join(2)
                self.assertFalse(self.launcher.is_running)

    def test_alive_owner_does_not_require_http_response(self):
        self.launcher.is_comfyui_responsive = Mock(return_value=False)
        self.watch()
        self.assertFalse(self.launcher._stop_event.wait(0.7))
        self.launcher.is_comfyui_responsive.assert_not_called()

    def test_restart_gap_is_allowed_and_new_owner_is_followed(self):
        self.launcher._owner_process = None
        self.launcher._restarting = True
        self.watch()
        self.assertFalse(self.launcher._stop_event.wait(0.7))
        child = self.child()
        with self.launcher._lifecycle_lock:
            self.launcher._owner_process = psutil.Process(child.pid)
            self.launcher._restarting = False
        self.assertFalse(self.launcher._stop_event.wait(0.7))
        child.terminate()
        child.wait(timeout=3)
        self.assertTrue(self.launcher._stop_event.wait(2))

    def test_restart_success_keeps_launcher(self):
        def restart():
            self.assertTrue(self.launcher._restarting)
            return True
        self.launcher._restart_comfyui = restart
        self.assertTrue(self.launcher.restart_comfyui())
        self.assertFalse(self.launcher._restarting)
        self.assertFalse(self.launcher._stop_event.is_set())

    def test_restart_failure_or_exception_stops_launcher(self):
        for error in (False, RuntimeError('startup failed')):
            with self.subTest(error=error):
                self.launcher._stop_event.clear()
                self.launcher.is_running = True
                self.launcher._restart_comfyui = Mock(return_value=False)
                if isinstance(error, Exception):
                    self.launcher._restart_comfyui.side_effect = error
                    with self.assertRaises(RuntimeError):
                        self.launcher.restart_comfyui()
                else:
                    self.assertFalse(self.launcher.restart_comfyui())
                self.assertTrue(self.launcher._stop_event.is_set())
                self.assertFalse(self.launcher._restarting)
                self.assertFalse(self.launcher.is_running)

    def test_concurrent_restart_rejected_without_stopping_active_restart(self):
        self.launcher._restarting = True
        self.launcher._restart_comfyui = Mock()
        self.assertFalse(self.launcher.restart_comfyui())
        self.launcher._restart_comfyui.assert_not_called()
        self.assertFalse(self.launcher._stop_event.is_set())

    def test_shutdown_does_not_kill_original_or_unrelated_process(self):
        self.launcher.stop_comfyui = Mock()
        self.launcher.shutdown()
        self.launcher.shutdown()
        self.launcher.stop_comfyui.assert_not_called()
        self.launcher.stop_api_server.assert_called_once()

    def test_shutdown_cleans_up_spawned_child(self):
        child = self.child()
        self.launcher.comfyui_process = child
        self.launcher._owner_process = psutil.Process(child.pid)
        self.launcher.shutdown()
        self.assertIsNotNone(child.poll())

    def test_shutdown_prevents_late_spawn(self):
        self.launcher.shutdown()
        self.launcher._start_comfyui = Mock()
        self.assertFalse(self.launcher.start_comfyui())
        self.launcher._start_comfyui.assert_not_called()

    def test_zombie_and_reused_pid_are_not_alive(self):
        owner = Mock()
        self.launcher._owner_process = owner
        owner.is_running.return_value = True
        owner.status.return_value = psutil.STATUS_ZOMBIE
        self.assertFalse(self.launcher._owner_alive())
        owner.is_running.return_value = False
        owner.status.return_value = psutil.STATUS_RUNNING
        self.assertFalse(self.launcher._owner_alive())

    def test_stop_failure_prevents_duplicate_start(self):
        self.launcher.is_comfyui_responsive = Mock(return_value=False)
        self.launcher.stop_comfyui = Mock(return_value=False)
        self.launcher.start_comfyui = Mock()
        self.assertFalse(self.launcher.restart_comfyui())
        self.launcher.start_comfyui.assert_not_called()

    def test_startup_timeout_is_failure_even_when_child_alive(self):
        self.launcher.is_comfyui_responsive = Mock(return_value=False)
        self.launcher.stop_comfyui = Mock(return_value=True)
        self.launcher.start_comfyui = Mock(return_value=True)
        self.launcher.comfyui_process = Mock()
        self.launcher.comfyui_process.poll.return_value = None
        self.launcher.python_executable = sys.executable
        self.launcher.comfyui_dir = self.launcher.working_directory = '/unused'
        self.launcher.comfyui_args = ['main.py']
        self.launcher.comfyui_port = 8188
        with patch.object(self.launcher._stop_event, 'wait', return_value=False), \
                patch('launcher_service.time.monotonic', side_effect=[0, 181]):
            self.assertFalse(self.launcher.restart_comfyui())
        self.assertTrue(self.launcher._stop_event.is_set())


if __name__ == '__main__':
    unittest.main()
