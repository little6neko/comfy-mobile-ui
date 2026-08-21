# Frames Editor 移动端适配实施计划

日期：2026-08-21
设计规格：`docs/superpowers/specs/2026-08-21-frames-editor-mobile-adaptation-design.md`

## 目标

在不修改服务器 `comfyui-easy-sam3` 的前提下，为 `easy framesEditor` 增加 Mobile Graph View 与 Stack View 共用的全屏标注器。实现必须保留桌面鼠标左键绿点、右键红点习惯，并为触摸提供显式绿点、红点和框选工具。

## 实现原则

- `PointEditor` 完全不动；新功能使用独立的数据契约和组件。
- `info` 只在用户点击确认时原子写回，其他交互都停留在草稿。
- 预览只来自当前页面生命周期中新提交的实时执行，不读取 history、WebSocket 滚动缓冲或 localStorage。
- 预览以 `workflowId + nodeId` 隔离，事件还必须匹配本页登记的 prompt。
- 先覆盖纯逻辑，再接 UI，最后做服务器实测。

## 任务 1：建立纯数据模型和测试

文件：

- 新建 `src/features/frames-editor/model.ts`
- 新建 `tests/integration/framesEditorModelTest.ts`
- 修改 `package.json`

步骤：

1. 先编写失败测试，覆盖空值、合法往返、未知顶层字段保留和非法已知字段拒绝。
2. 定义 `FramesEditorPoint`、`FramesEditorBox`、`FramesEditorInfo`、解析结果和规范空值。
3. 实现 `parseFramesEditorInfo`、`serializeFramesEditorInfo` 与显式重置；重置仅创建草稿，不负责写 Widget。
4. 实现不包含 `frame_index` 的标注历史 reducer，覆盖添加点、添加框、清空、撤销、重做和分支截断。
5. 实现 `contain` 显示矩形、CSS 指针到固有图像坐标、边界限制和框规范化纯函数。
6. 添加 `test:frames-editor` 脚本并运行：

   ```bash
   npm run test:frames-editor
   ```

## 任务 2：建立实时预览状态和事件桥

文件：

- 新建 `src/features/frames-editor/previewModel.ts`
- 新建 `src/features/frames-editor/previewStore.ts`
- 新建 `src/features/frames-editor/FramesEditorPreviewBridge.tsx`
- 新建 `tests/integration/framesEditorPreviewTest.ts`
- 修改 `src/App.tsx`

步骤：

1. 先用纯 action/reducer 测试描述以下状态转换：
   - `execution_started` 登记本页 prompt 与 workflow。
   - 匹配 `executing` 清除旧帧并设置当前 prompt。
   - 匹配 `executed` 接收帧；未登记、错误 workflow/node 或迟到 prompt 被忽略。
   - 坏 `preview_str` 进入错误态且不恢复旧帧。
   - 断线和服务器变化清空所有帧与 prompt 登记。
2. 校验 `preview[0].preview_str` 为非空描述数组；每项包含非空 `filename` 以及字符串 `type`、`subfolder`。
3. 使用无 persist 中间件的 Zustand store 保存 prompt 登记、节点当前执行和预览 revision。
4. 在 `FramesEditorPreviewBridge` 中直接订阅实时 EventEmitter 的 `execution_started`、`executing`、`executed`、`disconnected`；清理时用函数引用退订，不调用 `getExecutionStateBuffer()`。
5. 监听 `useConnectionStore` 的服务器 URL，变化时清空预览。
6. 将 Bridge 挂在 `AppRouter` 的路由外层，使其在用户执行前已初始化，并可跨 Graph/Stack 路由保留内存预览。

## 任务 3：实现指针画布

文件：

- 新建 `src/features/frames-editor/FramesEditorCanvas.tsx`

步骤：

1. 使用 `<img>` 与同位置 SVG 覆盖层显示当前 Blob URL、点、框和拖动框。
2. 用 `ResizeObserver` 和图像固有尺寸计算 `contain` 区域；留白中的 pointer down 直接忽略。
3. 使用 Pointer Events 与 Pointer Capture 统一触摸、笔和鼠标。
4. 实现输入规则：
   - 绿点模式：鼠标左键绿点、右键红点，触摸/笔添加绿点。
   - 红点模式：主按钮/触摸/笔添加红点，鼠标右键仍为红点。
   - 框选模式：主按钮或单指/笔拖动，低于 CSS 阈值不生成框，终点限制在图像内。
5. 设置 `touch-action: none`、禁用拖图、长按菜单和 context menu。
6. 标记尺寸在屏幕像素上近似恒定，并为选中工具之外的颜色增加形状区别。

## 任务 4：实现全屏工作区和入口卡片

文件：

- 新建 `src/features/frames-editor/FramesEditorWorkspace.tsx`
- 新建 `src/features/frames-editor/FramesEditorLauncher.tsx`
- 新建 `src/features/frames-editor/index.ts`

步骤：

1. Launcher 解析当前 `info`，显示正/负点、框数量以及空白/执行中/就绪/错误预览状态。
2. 通过 Portal 打开 `fixed inset-0` 工作区，处理安全区、锁定 body 滚动和屏幕旋转。
3. Workspace 打开时深拷贝已提交值；标注历史与 `frame_index` 分离，dirty 由规范草稿和基线比较得出。
4. 空预览时保留标注摘要，但禁用画布工具并显示“请先执行该节点”。编辑器绝不自动执行。
5. 根据当前帧描述创建 `ComfyFileService(serverUrl)`，调用 `downloadFile` 获取 Blob；切帧、重试、预览替换和卸载时释放旧 URL，并用请求 generation 防止迟到响应覆盖当前帧。
6. 实现绿点、红点、框选、撤销、重做、清空确认、帧滑杆和当前帧/总帧数。
7. 新预览到达时保留草稿；`is_init` 或 revision 变化显示检查提示，不自动清空标注。
8. 非法 `info` 时禁用主确认；显式确认重置后生成规范空草稿，保留可解析对象中的未知字段。
9. 脏草稿返回时显示“放弃修改 / 继续编辑”；确认时只调用一次 `onCommit(serializedInfo)`，关闭后提示再次执行。

## 任务 5：接入 Graph View 和 Stack View

文件：

- 修改 `src/components/canvas/NodeDetailModal.tsx`
- 修改 `src/components/workflow/WorkflowEditor.tsx`
- 修改 `src/components/workflow/WorkflowStackEditor.tsx`

步骤：

1. 给 NodeDetailModal 传入当前 `workflowId`。
2. 仅当节点类型严格等于 `easy framesEditor`、服务器元数据存在、参数名为 `info` 且可调用 `setWidgetValue` 时，用 Launcher 替代普通字符串 Widget。
3. `images` 连接状态和 `preview_rescale` 数字 Widget 保持现状。
4. 给 StackNode 传入父级 workflow ID，并应用相同严格判断和 Launcher。
5. 两个入口均通过现有 `getWidgetValue` 读取最新修改值，通过现有 `setWidgetValue(nodeId, "info", value)` 写回，确保未保存状态、运行时图和 Official Canvas bridge 同步。
6. 不按数组位置重建 `widgets_values`；依赖现有按名 Widget setter，只更新 `info` 对应槽位，以保留额外尾部值。

## 任务 6：本地化与可访问性

文件：

- 修改 `src/locale/en/common.json`
- 修改 `src/locale/zh/common.json`

步骤：

1. 添加 `framesEditor` 命名空间，覆盖入口、工具、帧、状态、错误、确认和提示文案。
2. 中文与英文提供完整文案；日语和韩语依赖项目现有 `fallbackLng: "en"`。
3. 所有工具按钮具备 `aria-label`、禁用态和 `aria-pressed`，触控目标至少 44 CSS 像素。
4. 空白、加载和错误通过可见文本表达，不只依赖 toast。

## 任务 7：自动验证与服务器实测

本地命令：

```bash
npm run test:frames-editor
npm run build
npx eslint \
  src/features/frames-editor \
  src/components/canvas/NodeDetailModal.tsx \
  src/components/workflow/WorkflowEditor.tsx \
  src/components/workflow/WorkflowStackEditor.tsx \
  src/App.tsx \
  tests/integration/framesEditorModelTest.ts \
  tests/integration/framesEditorPreviewTest.ts
git diff --check
```

本地移动端预览以用户要求的地址监听：

```bash
npm run dev -- --host 0.0.0.0
```

服务器基线：

- 插件路径：`/home/carbonsix/comfy/ComfyUI/custom_nodes/comfyui-easy-sam3`
- 当前插件提交：`c67885b1`
- 图片样例：`example_workflows/sam3_image_seg_by_points.json`
- 视频样例：`example_workflows/sam3_video_seg_by_point.json`

实测清单：

1. 记录服务器 `nodes.py`、`web/frames_editor.js`、`pyproject.toml` 的哈希，完成后再次比对。
2. 页面刷新后打开编辑器应为空；从 Graph View 单节点执行后才显示图片帧。
3. 在触屏和鼠标上分别验证绿点、红点、框、撤销、重做、清空及脏返回。
4. 确认 `info` 后重新执行，核对四个服务端输出。
5. 将 `preview_rescale` 设为 `0.5`，核对输出坐标是预览坐标的两倍。
6. 在视频样例上验证帧滑杆、单组跨帧标注及 `frame_index`。
7. 在 Graph View 与 Stack View 分别打开同一节点，确认两处读取并写回同一值。
8. 验证非法 `info`、下载失败、断线、刷新和屏幕旋转。
9. 确认服务器插件文件哈希完全未变。

## 完成条件

- 设计规格中的 8 项验收标准全部满足。
- 新增测试、生产构建和修改文件 lint 通过。
- 工作树只包含本功能预期改动；`.superpowers/` 可视化伴侣目录不进入提交。
- 服务器插件没有任何写入或修改。
