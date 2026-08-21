# CBP Builder 开发说明

- 这是一个 TypeScript VS Code 扩展，入口为 `src/extension.ts`。
- 扩展使用 `TreeDataProvider` 提供活动栏工程视图。
- 构建命令通过 `child_process.spawn` 在 `.cbp` 所在目录执行。
- 修改后使用 `npm.cmd run compile` 和 `npm.cmd run lint` 验证。
- 保持固件工程目录 `app/` 与扩展目录 `cbp-builder/` 相互独立。