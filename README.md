# CBP Builder

在 VS Code 活动栏中发现并编译 Code::Blocks `.cbp` 工程。

## 功能

- 递归扫描当前工作区中的 `.cbp` 文件，文件名和目录名不受限制。
- 解析工程标题、编译器、目标和源文件数量。
- 根据 CBP 工程配置自动生成 Makefile。
- 从 `cbpBuilder.toolchainSearchPaths`、`TOOLCHAIN_DIR` 或系统 `PATH` 查找工具链。
- 支持增量编译和全量编译。全量编译先执行 `make clean`，再执行 `make`。
- 活动栏视图展示当前工程、编译方式和最近一次结果。
- 支持活动栏工程节点和资源管理器 `.cbp` 文件右键菜单。
- 编译输出写入 `CBP Builder` Output Channel。

## 构建前提

- 工程目录必须包含名为 `Makefile` 或 `makefile` 的 Make 构建文件。
- `cbpBuilder.makeCommand` 默认使用 `mingw32-make`，需要正确安装MinGW，配置好相关的环境变量。
- Makefile 应能在 `.cbp` 工程所在目录执行；扩展会在该目录运行 Make 命令。
- 如果输出出现 `No targets specified and no makefile found`，请先为工程生成或放置 Makefile，再重新执行编译。

## 使用

1. 按 `F5` 启动扩展开发主机。
2. 在活动栏打开 **CBP Builder**。
3. 使用视图标题栏添加 `.cbp`，或等待工作区自动扫描。
4. 在工程节点或 `.cbp` 文件上右键选择增量编译或全量编译。
5. 在“输出”面板选择 `CBP Builder` 查看日志。

## 工具链设置

```json
{
	"cbpBuilder.toolchainSearchPaths": ["C:/Program Files (x86)/RV32-Toolchain/RV32-V2/bin"],
	"cbpBuilder.makeCommand": "mingw32-make"
}
```

## 验证

在 `cbp-builder` 目录执行 `npm.cmd install`、`npm.cmd run compile` 和 `npm.cmd run lint`。

## 更新记录

详细变更请参阅 [CHANGELOG.md](CHANGELOG.md)。当前版本为 `v0.0.12-beta`。
