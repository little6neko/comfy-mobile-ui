# Frames Editor 移动端适配设计

日期：2026-08-21
状态：已由用户确认

## 1. 目标

在 Comfy Mobile UI 中为服务器插件 `comfyui-easy-sam3` 的 `easy framesEditor` 节点提供触屏优先的完整编辑体验。用户应能在 Mobile Graph View 的节点详情和 Stack View 中打开同一个全屏标注工作区，完成正向点、负向点、边界框和视频起始帧编辑。

适配必须继续使用该节点现有的 `info` JSON 数据契约和执行输出，不修改服务器上的 Python 节点或 `web/frames_editor.js`。

## 2. 已有实现与约束

服务器安装的 `comfyui-easy-sam3` 版本为 1.0.4。`easy framesEditor` 的服务端契约如下：

- 输入：`images: IMAGE`、`info: STRING`、`preview_rescale: FLOAT`。
- 输出：`positive_coords: STRING`、`negative_coords: STRING`、`bboxes: BBOX`、`frame_index: INT`。
- 节点是 output node，执行后通过 UI 输出中的 `preview` 返回临时图片描述列表。
- `preview_rescale` 小于 1 时，服务端负责将预览坐标换算回原图坐标。
- 桌面扩展使用左键添加正向点、右键添加负向点，并支持边界框、帧滑杆、撤销、重做和清空。

Comfy Mobile UI 已具备以下可复用基础设施：

- `GlobalWebSocketService` 可接收原始 `executing` 和 `executed` 消息。
- `ComfyFileService` 可通过 ComfyUI `/view` 接口下载临时帧，并沿用现有 ComfyUI-Login 认证处理。
- `useWidgetValueEditor.setWidgetValue` 可将值写回运行时图、未保存修改状态和活跃的 Official Canvas bridge。
- `NodeDetailModal` 和 `WorkflowStackEditor` 均有专用 Widget 渲染接入点。

现有 `PointEditor` 只服务于另一种 `PointsEditor` 节点。它使用 `points_store`、`coordinates`、`neg_coordinates`、`width` 和 `height`，背景图由用户选择，且不支持视频帧、边界框和重做。该组件与本功能没有共享的数据契约，本次不修改、不重构也不复用它。

## 3. 范围

### 3.1 包含

- 正向绿点、负向红点和边界框三种显式触屏工具。
- 撤销、重做和可撤销的清空操作。
- 单帧图片和多帧视频预览。
- 视频帧滑杆、当前帧/总帧数和 `frame_index` 编辑。
- 已有标注的载入、确认写回和工作流保存恢复。
- Mobile Graph View 节点详情和 Stack View 两个入口。
- 触摸、手写笔和鼠标输入。
- 当前页面生命周期中实时执行所得的预览接收；刷新即清空。
- 加载、解析、断线和脏草稿保护。
- 中英文 UI 文案。

### 3.2 不包含

- 修改服务器 `comfyui-easy-sam3`。
- 修改现有 `PointEditor`。
- 让每一帧拥有独立标注集合；服务端契约只有一组标注和一个帧号。
- 从 ComfyUI history、服务器缓存、localStorage 或 IndexedDB 恢复预览。
- 打开编辑器时自动执行节点。
- 建立通用的任意 ComfyUI DOM Widget 兼容层。
- 改造 Official Canvas iframe 内已有的桌面扩展 UI。

## 4. 已确认的体验决策

### 4.1 入口与布局

当节点类型严格等于 `easy framesEditor` 时：

- 节点详情和 Stack View 不再将 `info` 显示为普通长字符串输入框。
- 原位置显示“打开帧编辑器”卡片，包括点、框数量和预览是否就绪。
- 点击卡片后通过 Portal 打开占满视口的标注工作区。
- `images` 仍按已连接输入展示，`preview_rescale` 继续使用现有数字控件。

工作区尊重安全区，主要操作目标不小于 44 CSS 像素。画布占用除标题栏、工具栏和帧导航之外的可用空间，横竖屏变化只重新布局，不改变图像坐标。

### 4.2 输入规则

- 触摸或手写笔先选择“绿点”“红点”或“框选”。点按添加所选点，拖动完成边界框。
- 默认工具为绿点。
- 鼠标在默认绿点模式下保持桌面习惯：左键添加绿点，右键添加红点。
- 选择红点工具后，鼠标左键也可添加红点；右键仍添加红点。
- 框选模式使用鼠标左键或单指/笔拖动；过小的拖动不生成框。
- 画布使用 Pointer Events 和 Pointer Capture。交互期间阻止页面滚动、图片长按菜单和画布右键菜单。
- 坐标从指针的 CSS 位置换算为预览图像的固有像素位置，正确排除 `object-fit: contain` 产生的留白。
- 在 `contain` 留白中开始的点按或拖动直接忽略；从图像内开始、在图像外结束的框选将终点限制到图像边界。
- 新点和新框限制在图像边界内。标记以接近固定屏幕尺寸绘制，缩小预览时仍清晰可点。

### 4.3 草稿与提交

- 打开工作区时解析当前已提交的 `info`，创建独立深拷贝草稿。
- 点、框、清空和帧选择在编辑过程中只修改草稿。
- 添加点、完成框选和清空各形成一个历史快照；撤销后产生新操作会丢弃重做分支。
- 帧滑杆不进入撤销历史。
- 点击右上角确认按钮后，一次性序列化并写回 `info`，随后关闭工作区并将工作流标为未保存。
- 有未提交改动时直接返回，显示“放弃修改 / 继续编辑”确认；无改动时直接关闭。
- 编辑器打开期间执行工作流不会自动提交草稿，服务器继续使用上一次已确认的 `info`。
- 确认写回后提示用户再次执行节点，新的标注输出才会传给下游节点。

### 4.4 视频帧语义

- 整个节点只有一组正向点、负向点和边界框。
- 切换帧时保留这组标注，只更新 `frame_index`。
- 每次只按需加载当前帧，不预加载全部视频帧。
- 若新预览帧数小于已有 `frame_index`，只在草稿中将其限制到最后一个有效帧；确认前不写回工作流。

## 5. 架构

实现拆分为职责单一的模块，具体文件名可在实现计划中微调，但边界保持不变。

### 5.1 Frames Editor 数据模型

负责：

- TypeScript 类型和运行时校验。
- 空值默认化、已知字段解析、未知字段保留。
- 草稿深拷贝与规范序列化。
- 历史 reducer 和 dirty 比较。
- 图像坐标映射及边界框规范化的纯函数。

该模块不依赖 React、WebSocket 或工作流对象，可由自执行 TypeScript 测试直接覆盖。

### 5.2 Frames Editor 预览状态

使用无持久化的内存状态保存预览，键为 `workflowId + nodeId`。该状态在应用壳层初始化一次，不能等到打开 Workspace 时才开始监听，否则会漏掉用户先执行、后打开编辑器的合法预览。它负责：

- 监听本页面生命周期内的 `execution_started`，在内存中登记 `prompt_id + workflowId`；`PromptTracker` 只可用于核对这批已登记的实时 prompt，不能把 localStorage 中的历史条目直接恢复成预览资格。
- 在匹配节点开始执行时清除该节点上一次预览。
- 将匹配的 `executing` prompt 记为该 `workflowId + nodeId` 当前执行；只接收同一当前 prompt 的 `executed.output.preview`，忽略旧 prompt 的迟到事件。
- 保存帧描述、`is_init`、加载状态和错误状态。
- 在 WebSocket 断开、服务器地址变化或页面刷新后清空预览和本页 prompt 登记。

该状态只由初始化后的实时 EventEmitter 事件填充，不读取 `GlobalWebSocketService.getExecutionStateBuffer()`，也不从 history、`PromptTracker` localStorage 或其他持久化位置补种。它可以跨 Mobile Graph View 与 Stack View 路由切换保留同一次实时执行结果，但不能跨页面刷新恢复。

### 5.3 FramesEditorLauncher

负责：

- 替代 `info` 的普通 Widget 展示。
- 显示已有标注数量和预览状态。
- 接收当前 `info`、预览状态和原子 `onCommit(value)` 回调。
- 打开和关闭全屏工作区。

`NodeDetailModal` 与 `WorkflowStackEditor` 只做严格节点类型判断和传参，不包含标注逻辑。

### 5.4 FramesEditorWorkspace

负责：

- 草稿生命周期、工具选择、帧选择和历史控制。
- 顶栏确认/返回、清空确认及脏草稿确认。
- 空白、加载、预览错误和非法 `info` 状态。
- 按当前帧描述调用 `ComfyFileService`，创建并释放 Blob URL。
- 在执行产生新预览时保留草稿并提示用户检查标注。

### 5.5 FramesEditorCanvas

负责：

- 绘制当前帧、点、已完成框和拖动中的框。
- CSS 坐标与图像坐标转换。
- Pointer Events、Pointer Capture 和鼠标右键快捷操作。
- 将语义动作上报给 Workspace，不直接写 Widget 或 WebSocket 状态。

## 6. 数据契约

规范 `info` 结构为：

```json
{
  "positive_coords": [{"x": 100, "y": 80}],
  "negative_coords": [{"x": 240, "y": 160}],
  "bbox": [{"x": 40, "y": 30, "w": 180, "h": 220}],
  "frame_index": 0
}
```

规则：

- 空字符串、仅空白字符串，或合法 JSON 对象中缺失的已知字段，使用四个规范默认值：三个空数组和第 0 帧。合法根值必须是 JSON 对象；`null`、数组和标量均视为非法。
- 点坐标及框的 `x`、`y`、`w`、`h` 必须是有限非负数字；`frame_index` 必须是非负整数。没有预览尺寸时不做坐标上界猜测。
- 新生成的框规范为非负宽高的 `{x, y, w, h}`。
- 未识别的顶层字段在解析和序列化往返中原样保留，以兼容插件未来版本。
- 不在客户端乘除 `preview_rescale`。`info` 保存预览图像坐标，服务端按现有逻辑还原原图尺度。
- 只按名称更新 `info`。工作流 `widgets_values` 中 `preview_rescale` 和桌面 DOM Widget 可能留下的额外尾部值不得被重排或删除。

非法 JSON 或非法已知字段不会被静默修复。工作区显示错误并禁用确认按钮；用户明确确认“重置标注数据”后，只生成一份规范空草稿并重新启用确认，仍须点击右上角确认才会写回 Widget。若原值是可解析对象，重置时保留未知顶层字段；若根值无法解析或不是对象，则没有未知字段可保留。

## 7. 执行与预览数据流

1. 用户打开节点但尚未在当前页面生命周期执行它：Launcher 和 Workspace 均显示无预览状态；画布与标注工具禁用。
2. 用户通过现有节点或工作流执行入口提交工作流。编辑器不会自行提交任务；提交成功发出的 `execution_started` 将本次 prompt 登记为本页实时执行。
3. 已登记 prompt 的匹配 `executing` 事件到达时，预览状态清除该节点的旧帧、记住当前 prompt，并进入加载状态。
4. `executed` 到达后，状态层校验 `data.node`、`data.prompt_id` 和 `data.output.preview[0]`；未登记、工作流不匹配或不是该节点当前执行的 prompt 一律忽略。
5. `preview_str` 必须解析为非空数组；每项的 `filename` 必须是非空字符串，`type` 和 `subfolder` 必须是字符串，其中 `subfolder` 可以为空。合法结果写入内存状态；不合法结果进入错误状态且不回退到旧预览。
6. Workspace 按当前 `frame_index` 使用 `ComfyFileService` 下载对应临时图片，解码后交给 Canvas。
7. 用户编辑草稿并点击确认，Launcher 调用现有 `setWidgetValue(nodeId, "info", json)`。
8. 该写入进入现有未保存修改机制，并在 bridge 活跃时同步 Official Canvas 图中的同名 Widget。
9. 用户再次执行后，服务器从新的 `info` 计算四个节点输出并传给下游。

服务端 `is_init` 不直接清除 `info` 或未提交草稿。新预览替换背景后，Workspace 显示“预览已更新，请检查或清空标注”。这样可保留已保存标注，并遵守只有点击确认才修改工作流的事务边界。

## 8. 错误处理与资源生命周期

- 无预览不是错误，只显示“请先执行该节点”的空白状态。
- 非法执行 payload 清空旧预览并显示可诊断错误；恢复方式是重新执行节点。
- 单帧下载或图片解码失败时显示“重试”，草稿、历史和帧号均保留。
- WebSocket 断开、服务器切换或认证失效时清空预览状态，不展示旧服务器帧。
- `ComfyFileService` 沿用全局 Axios 认证拦截器；前端不手工拼接或记录认证 token。
- 当前帧 Blob URL 在切帧、预览替换、关闭 Workspace 和组件卸载时释放。
- 屏幕旋转和视口尺寸变化只重新计算显示矩形，不重写标注。
- 工作区有脏草稿时的新执行结果不会覆盖草稿；仅替换背景并显示检查提示。
- 节点扩展缺失时沿用项目现有 Missing Node 处理，不显示可用的专用编辑入口。

## 9. 可访问性与本地化

- 所有图标按钮提供可读标签和禁用状态。
- 工具选择不只依赖颜色，同时显示“绿点 / 红点 / 框选”文字或形状图标。
- 当前工具使用边框、背景和 `aria-pressed` 表示。
- 触控目标不小于 44 CSS 像素。
- 状态和错误消息通过可见文本表达，不只使用 toast。
- 新增中文、英文和项目现有其他语言文件所需的回退键；中文与英文提供完整文案，其他语言可先回退英文。

## 10. 测试设计

### 10.1 自动测试

按照项目现有 `tsx` 自执行测试风格增加纯逻辑测试，至少覆盖：

- 空 `info` 默认值。
- 合法数据解析与序列化往返。
- 未知字段保留。
- 非法 JSON、NaN/Infinity、非法框和非法帧号拒绝。
- 不同图像/容器宽高比及 contain 留白下的坐标换算，误差不超过 1 个图像像素。
- 点、框、清空、撤销、重做和分支截断。
- 切帧不进入历史且不清除标注。
- 预览事件的 workflow、prompt 和 node 过滤。
- WebSocket 滚动缓冲、history 和 `PromptTracker` 历史条目不会生成预览；本页新提交的实时 prompt 可以生成预览。
- 同一节点的新执行开始后，旧 prompt 的迟到 `executed` 不会覆盖新状态。
- 执行开始、断线、坏 payload 时旧预览清除。
- 更新 `info` 后其余 `widgets_values` 值和顺序保持不变。

验证命令包括新增测试脚本、`npm run build`，以及对修改文件的 lint 检查。仓库若存在与本功能无关的基线 lint 问题，应单独记录；本功能不得增加新的 lint 错误。

### 10.2 服务器实测

在服务器当前插件和示例工作流上验证：

- 图片工作流执行前为空，执行 Frames Editor 后显示单帧。
- 触屏添加绿点、红点和框，撤销/重做、清空后撤销均正确。
- 鼠标默认左键绿点、右键红点，框选模式可拖动。
- 确认后 `info` 内容正确，保存和重载工作流后标注可恢复。
- `preview_rescale=0.5` 时，服务端节点输出坐标按原图尺度正确还原。
- 视频工作流显示帧总数；切换帧保留标注，输出 `frame_index` 正确。
- Mobile Graph View 节点详情和 Stack View 均可打开同一编辑器。
- 非法 `info`、临时帧加载失败、WebSocket 断线、屏幕旋转和未保存返回确认符合设计。
- 服务器 `comfyui-easy-sam3` 文件在适配前后无变化。

## 11. 验收标准

功能在以下条件全部满足时完成：

1. 当前页面执行前不显示任何旧预览；刷新后仍为空，只有本页新提交且匹配节点执行成功后才显示帧。
2. 手机用户可通过显式工具完成点和框标注，页面滚动或系统菜单不会干扰画布。
3. 鼠标默认左键绿点、右键红点行为保留。
4. 撤销、重做、清空、单组跨帧标注和 `frame_index` 行为符合设计。
5. 只有确认按钮会写回工作流；放弃草稿不会改变 `info`。
6. 保存、重载、再次执行后，四个节点输出能正确驱动下游 SAM3 节点。
7. 图片和视频示例、`preview_rescale`、Graph View 和 Stack View 均通过实测。
8. 自动测试与生产构建通过，且服务器插件没有被修改。
