// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

type BuildMode = 'incremental' | 'full';
const compileRunExtensionId = 'danielpinto8zz6.c-cpp-compile-run';
interface CbpProject { file: string; title: string; compiler: string; target: string; output: string; objectOutput: string; files: string[]; compileSources: string[]; appXmSource?: string; compileOptions: string[]; includeDirectories: string[]; linkOptions: string[]; linkDirectories: string[]; libraries: string[]; preBuild?: string; postBuild?: string; }

class ProjectItem extends vscode.TreeItem {
	readonly contextValue = 'cbpProject';
	constructor(readonly project: CbpProject) {
		super(project.title, vscode.TreeItemCollapsibleState.Collapsed);
		this.description = path.relative(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(project.file), project.file);
		this.tooltip = project.file;
		this.iconPath = new vscode.ThemeIcon('project');
		this.command = { command: 'vscode.open', title: '打开 CBP 工程', arguments: [vscode.Uri.file(project.file)] };
	}
}

class ProjectProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;
	projects: CbpProject[] = [];
	mode: BuildMode = 'incremental';
	lastResult = '尚未编译';
	private compileRunDisableAttempted = false;
	getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }
	getChildren(item?: vscode.TreeItem): vscode.TreeItem[] {
		if (!item) {return this.projects.map(project => new ProjectItem(project));}
		if (item instanceof ProjectItem) {return [new vscode.TreeItem(`工程文件: ${item.project.files.length} 个`), new vscode.TreeItem(`编译器: ${item.project.compiler || '未声明'}`), new vscode.TreeItem(`目标: ${item.project.target || 'Debug'}`), new vscode.TreeItem(`编译配置: ${item.project.compileOptions.length} 个选项`), new vscode.TreeItem(`头文件目录: ${item.project.includeDirectories.length} 个`), new vscode.TreeItem(`链接库: ${item.project.libraries.join(', ') || '未声明'}`), new vscode.TreeItem(`编译方式: ${this.mode === 'full' ? '全量编译' : '增量编译'}`), new vscode.TreeItem(`编译结果: ${this.lastResult}`)];}
		return [];
	}
	refresh(): void { this.changed.fire(); }
	async scan(): Promise<void> {
		const found = await vscode.workspace.findFiles('**/*.cbp', '**/{node_modules,.git,Output}/**');
		this.projects = found.map(uri => parseCbp(uri.fsPath)).filter((project): project is CbpProject => project !== undefined);
		if (!this.projects.length) {this.lastResult = '未找到 .cbp 工程';}
		await vscode.commands.executeCommand('setContext', 'cbpBuilder.hasProjects', this.projects.length > 0);
		if (this.projects.length && !this.compileRunDisableAttempted) {
			this.compileRunDisableAttempted = true;
			void disableCompileRunExtension();
		}
		this.refresh();
	}
	add(file: string): void { const project = parseCbp(file); if (project && !this.projects.some(item => item.file === project.file)) {this.projects.push(project); void vscode.commands.executeCommand('setContext', 'cbpBuilder.hasProjects', true);} this.refresh(); }
}

async function disableCompileRunExtension(): Promise<void> {
	if (!vscode.extensions.getExtension(compileRunExtensionId)) {return;}
	try {
		await vscode.commands.executeCommand('workbench.extensions.action.disableWorkspaceExtension', compileRunExtensionId);
		vscode.window.showInformationMessage('检测到 CBP 工程，已在当前工作区禁用 C/C++ Compile Run 扩展。');
	} catch {
		vscode.window.showWarningMessage('检测到 CBP 工程，但无法自动禁用 C/C++ Compile Run 扩展，请在扩展面板中选择“在工作区禁用”。');
	}
}

function parseCbp(file: string): CbpProject | undefined {
	try {
		const xml = fs.readFileSync(file, 'utf8');
		const compilerBlock = xml.match(/<Compiler>([\s\S]*?)<\/Compiler>/)?.[1] ?? '';
		const linkerBlock = xml.match(/<Linker>([\s\S]*?)<\/Linker>/)?.[1] ?? '';
		const targetBlock = xml.match(/<Target\b[\s\S]*?<\/Target>/)?.[0] ?? '';
		const units = [
			...[...xml.matchAll(/<Unit\s+filename="([^"]+)"\s*>([\s\S]*?)<\/Unit>/g)].map(match => ({ file: match[1], metadata: match[2] })),
			...[...xml.matchAll(/<Unit\s+filename="([^"]+)"\s*\/>/g)].map(match => ({ file: match[1], metadata: '' }))
		];
		const extraCommands = [...xml.matchAll(/<Add\s+(before|after)="([^"]+)"\s*\/>/g)];
		return {
			file,
			title: xml.match(/<Option\s+title="([^"]+)"/)?.[1] ?? path.basename(file, '.cbp'),
			compiler: xml.match(/<Option\s+compiler="([^"]+)"/)?.[1] ?? '',
			target: targetBlock.match(/<Target\s+title="([^"]+)"/)?.[1] ?? 'Debug',
			output: targetBlock.match(/<Option\s+output="([^"]+)"/)?.[1] ?? 'Output/bin/app.rv32',
			objectOutput: targetBlock.match(/<Option\s+object_output="([^"]+)"/)?.[1] ?? 'Output/obj/',
			files: units.map(unit => unit.file),
			compileSources: units.filter(unit => /\.c$/i.test(unit.file) && /compilerVar="CC"/.test(unit.metadata)).map(unit => unit.file),
			appXmSource: units.find(unit => /(?:^|\/)app\.xm$/i.test(unit.file) && /buildCommand="[^"]*-o \$\(TARGET_OUTPUT_DIR\)appxm\.o/.test(unit.metadata))?.file,
			compileOptions: [...compilerBlock.matchAll(/<Add\s+option="([^"]+)"/g)].map(match => match[1]),
			includeDirectories: [...compilerBlock.matchAll(/<Add\s+directory="([^"]+)"/g)].map(match => match[1]),
			linkOptions: [...linkerBlock.matchAll(/<Add\s+option="([^"]+)"/g)].map(match => match[1]),
			linkDirectories: [...linkerBlock.matchAll(/<Add\s+directory="([^"]+)"/g)].map(match => match[1]),
			libraries: [...linkerBlock.matchAll(/<Add\s+library="([^"]+)"/g)].map(match => match[1]),
			preBuild: extraCommands.find(match => match[1] === 'before')?.[2],
			postBuild: extraCommands.find(match => match[1] === 'after')?.[2]
		};
	} catch { return undefined; }
}

function makefilePath(project: CbpProject): string {
	return path.join(path.dirname(project.file), 'Makefile');
}

function quoteMake(value: string): string {
	return value.replace(/\\/g, '/').replace(/([ #$])/g, '\\$1');
}

function toGccLinkerOption(option: string): string {
	const normalized = option.replace(/\\/g, '/').replace(/\$\(TARGET_OBJECT_DIR\)ram\.o/, '$(OBJ_DIR)/ram.o');
	if (normalized.startsWith('-Wl,')) {return normalized;}
	if (normalized === '--gc-sections' || normalized.startsWith('-Map=') || normalized.startsWith('-T')) {
		return `-Wl,${normalized}`;
	}
	return normalized;
}

function generateMakefile(project: CbpProject): string {
	const output = project.output.replace(/\\/g, '/');
	const objectOutput = project.objectOutput.replace(/\\/g, '/').replace(/\/$/, '');
	const outputDirectory = path.posix.dirname(output);
	const linkerOptions = project.linkOptions.map(toGccLinkerOption);
	const sources = project.compileSources.map(source => source.replace(/\\/g, '/'));
	const objects = sources.map((_, index) => `$(OBJ_DIR)/source-${index}.o`);
	const appXmSource = project.appXmSource?.replace(/\\/g, '/');
	const libraryDirectories = project.linkDirectories.map(directory => `-L${quoteMake(directory.replace(/\\/g, '/'))}`);
	const lines = [
		`# Generated from ${path.basename(project.file)}. Do not edit manually.`,
		'PROJECT := ' + quoteMake(project.title),
		'.DEFAULT_GOAL := all',
		'',
		'TOOLCHAIN_DIR ?= C:/Program Files (x86)/RV32-Toolchain/RV32-V2/bin',
		'TOOLCHAIN ?= $(TOOLCHAIN_DIR)/riscv32-elf-',
		'CC := $(TOOLCHAIN)gcc',
		'export PATH := $(TOOLCHAIN_DIR);$(PATH)',
		'',
		`OUT_DIR := ${quoteMake(path.posix.dirname(outputDirectory))}`,
		`BIN_DIR := ${quoteMake(outputDirectory)}`,
		`OBJ_DIR := ${quoteMake(objectOutput)}`,
		`TARGET := ${quoteMake(output)}`,
		'',
		`CPPFLAGS := ${project.includeDirectories.map(directory => `-I${quoteMake(directory)}`).join(' ')}`,
		`CFLAGS := ${project.compileOptions.join(' ')}`,
		`LDFLAGS := -nostdlib ${linkerOptions.join(' ')}`,
		`LDLIBS := ${[...libraryDirectories, ...project.libraries.map(library => `-l${library.replace(/^lib/, '')}`), ...project.linkOptions.filter(option => /^-L/.test(option))].join(' ')}`,
		'',
		`OBJECTS := ${objects.join(' ')}`,
		'',
		'.PHONY: all clean prebuild postbuild',
		'all: postbuild',
		'',
		`$(TARGET): $(OBJECTS) $(OBJ_DIR)/ram.o${appXmSource ? ' $(BIN_DIR)/appxm.o' : ''} | prebuild`,
		'\t"$(CC)" $(OBJECTS) $(LDFLAGS) $(LDLIBS) -o "$@"',
		''
	];
	sources.forEach((source, index) => {
		lines.push(`${objects[index]}: ${quoteMake(source)} | $(OBJ_DIR)`);
		lines.push(`\t"$(CC)" $(CPPFLAGS) $(CFLAGS) -c "$<" -o "$@"`, '');
	});
	lines.push(
		'$(OBJ_DIR)/ram.o: ram.ld | $(OBJ_DIR)',
		'\t"$(CC)" $(CFLAGS) $(CPPFLAGS) -E -P -x c -c "$<" -o "$@"',
		'',
		'$(BIN_DIR) $(OBJ_DIR):',
		'\t@if not exist "$@" mkdir "$@"',
		''
	);
	if (appXmSource) {
		lines.push(
			'$(BIN_DIR)/appxm.o: ' + quoteMake(appXmSource) + ' | $(BIN_DIR)',
			'\t"$(CC)" $(CFLAGS) $(CPPFLAGS) -E -P -x c -c "$<" -o "$@"',
			''
		);
	}
	if (project.preBuild) {lines.push('prebuild: | $(BIN_DIR) $(OBJ_DIR)', `\t${project.preBuild.replace(/\$\(PROJECT_NAME\)/g, '$(PROJECT)')}`, '');}
	else {lines.push('prebuild: | $(BIN_DIR) $(OBJ_DIR)', '');}
	if (project.postBuild) {lines.push('postbuild: $(TARGET)', `\t${project.postBuild.replace(/\$\(PROJECT_NAME\)/g, '$(PROJECT)')}`, '');}
	else {lines.push('postbuild: $(TARGET)', '');}
	lines.push(
		'clean:',
		'\t-powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item -LiteralPath \'$(OBJ_DIR)\' -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath \'$(TARGET)\' -Force -ErrorAction SilentlyContinue; exit 0"',
		''
	);
	return lines.join('\r\n');
}

function ensureMakefile(project: CbpProject, output: vscode.OutputChannel): string {
	const file = makefilePath(project);
	const generatedMarker = `# Generated from ${path.basename(project.file)}. Do not edit manually.`;
	if (fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes(generatedMarker)) {
		output.appendLine(`[CBP Builder] Makefile: ${file}`);
		return file;
	}
	fs.writeFileSync(file, generateMakefile(project), 'utf8');
	output.appendLine(`[CBP Builder] 已根据 ${path.basename(project.file)} 生成 Makefile: ${file}`);
	return file;
}

function findToolchain(): string | undefined {
	const configured = vscode.workspace.getConfiguration('cbpBuilder').get<string[]>('toolchainSearchPaths', []);
	const roots = ['C:/Program Files (x86)/RV32-Toolchain', 'C:/Program Files/RV32-Toolchain', 'C:/RV32-Toolchain', 'D:/RV32-Toolchain', ...configured, process.env.TOOLCHAIN_DIR ?? ''];
	const candidates = [...roots.flatMap(root => [root, path.join(root, 'bin'), path.join(root, 'RV32-V2', 'bin'), path.join(root, 'RV32-V2')]), ...(process.env.PATH ?? '').split(path.delimiter)];
	return candidates.filter(Boolean).find(candidate => {
		try { return fs.readdirSync(candidate).some(file => /^(mingw32-make|make|riscv32-elf-(gcc|xmaker))(\.exe)?$/i.test(file)); } catch { return false; }
	});
}

function createOutputDecoder(): { decode: (data: Buffer) => string; flush: () => string } {
	const decoder = new TextDecoder(process.platform === 'win32' ? 'gb18030' : 'utf-8');
	return {
		decode: data => decoder.decode(data, { stream: true }),
		flush: () => decoder.decode()
	};
}

function formatOutputPath(value: string): string {
	const normalized = value.replace(/^([a-z]):/i, (_, drive: string) => `${drive.toUpperCase()}:`);
	return normalized.replace(/ /g, '\u00a0').replace(/^([A-Z]):/, '$1\u2060:');
}

type BuildResource = vscode.Uri | ProjectItem;

async function chooseProject(provider: ProjectProvider, resource?: BuildResource): Promise<CbpProject | undefined> {
	if (resource instanceof ProjectItem) {return resource.project;}
	if (resource?.fsPath.toLowerCase().endsWith('.cbp')) {return parseCbp(resource.fsPath);}
	if (provider.projects.length === 1) {return provider.projects[0];}
	return (await vscode.window.showQuickPick(provider.projects.map(project => ({ label: project.title, description: project.file, project }))))?.project;
}

async function build(provider: ProjectProvider, mode: BuildMode, resource?: BuildResource): Promise<void> {
	const project = await chooseProject(provider, resource);
	if (!project) {return;}
	const saved = await vscode.workspace.saveAll(false);
	if (!saved) {
		vscode.window.showErrorMessage('无法保存当前工作区的所有文件，已取消编译');
		return;
	}
	provider.mode = mode;
	provider.lastResult = `${mode === 'full' ? '全量' : '增量'}编译中...`;
	provider.refresh();
	const make = vscode.workspace.getConfiguration('cbpBuilder').get<string>('makeCommand', 'mingw32-make');
	const toolchain = findToolchain();
	const output = vscode.window.createOutputChannel('CBP Builder');
	output.clear();
	output.show(true);
	const modeLabel = mode === 'full' ? '全量编译' : '增量编译';
	const projectDirectory = path.dirname(project.file);
	output.appendLine('='.repeat(72));
	output.appendLine(`[CBP Builder] ${modeLabel}`);
	output.appendLine(`[CBP Builder] 工程: ${formatOutputPath(project.file)}`);
	output.appendLine(`[CBP Builder] 目录: ${formatOutputPath(projectDirectory)}`);
	output.appendLine(`[CBP Builder] 工具链: ${formatOutputPath(toolchain ?? '默认环境')}`);
	output.appendLine(`[CBP Builder] Make: ${make}`);
	output.appendLine('='.repeat(72));
	try { ensureMakefile(project, output); } catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		output.appendLine(`[失败] 生成 Makefile: ${message}`);
		vscode.window.showErrorMessage(`${project.title} 无法生成 Makefile，请查看 CBP Builder 输出`);
		provider.lastResult = `${mode === 'full' ? '全量' : '增量'}编译失败，无法生成 Makefile`;
		provider.refresh();
		return;
	}
	const env = { ...process.env, ...(toolchain ? { PATH: `${toolchain}${path.delimiter}${process.env.PATH ?? ''}` } : {}) };
	const run = (phase: string, args: string[]) => new Promise<number>(resolve => {
		const startedAt = Date.now();
		const command = [make, '--no-print-directory', '--trace', ...args].join(' ');
		output.appendLine('');
		output.appendLine(`----- ${phase} -----`);
		output.appendLine(`[命令] ${command}`);
		const child = cp.spawn(make, ['--no-print-directory', '--trace', ...args], { cwd: path.dirname(project.file), env, shell: true });
		const stdoutDecoder = createOutputDecoder();
		const stderrDecoder = createOutputDecoder();
		child.stdout.on('data', data => output.append(stdoutDecoder.decode(data)));
		child.stderr.on('data', data => output.append(stderrDecoder.decode(data)));
		child.on('close', code => {
			output.append(stdoutDecoder.flush());
			output.append(stderrDecoder.flush());
			const exitCode = code ?? 1;
			const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
			output.appendLine('');
			output.appendLine(`[${exitCode === 0 ? '完成' : '失败'}] ${phase}，退出码 ${exitCode}，耗时 ${elapsed}s`);
			resolve(exitCode);
		});
	});
	const cleanCode = mode === 'full' ? await run('清理旧输出', ['clean']) : 0;
	const code = cleanCode === 0 ? await run(modeLabel, []) : cleanCode;
	provider.lastResult = code === 0 ? `成功 (${new Date().toLocaleTimeString()})` : `失败，退出码 ${code}`;
	provider.refresh();
	output.appendLine('');
	output.appendLine(`===== ${code === 0 ? '构建成功' : '构建失败'} =====`);
	if (code === 0) {vscode.window.showInformationMessage(`${project.title} 编译成功`);} else {vscode.window.showErrorMessage(`${project.title} 编译失败，请查看 CBP Builder 输出`);}
}

export function activate(context: vscode.ExtensionContext): void {
	const provider = new ProjectProvider();
	const incrementalItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	incrementalItem.text = '$(play) 增量编译';
	incrementalItem.tooltip = 'CBP Builder：增量编译';
	incrementalItem.command = 'cbpBuilder.buildIncremental';
	const fullItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
	fullItem.text = '$(debug-restart) 全量编译';
	fullItem.tooltip = 'CBP Builder：全量编译';
	fullItem.command = 'cbpBuilder.buildFull';
	const updateStatusBar = (): void => {
		if (provider.projects.length) {incrementalItem.show(); fullItem.show();} else {incrementalItem.hide(); fullItem.hide();}
	};
	context.subscriptions.push(incrementalItem, fullItem, provider.onDidChangeTreeData(() => updateStatusBar()));
	context.subscriptions.push(vscode.window.registerTreeDataProvider('cbpBuilder.projects', provider));
	context.subscriptions.push(vscode.commands.registerCommand('cbpBuilder.addProject', async () => { const files = await vscode.window.showOpenDialog({ canSelectMany: true, filters: { 'Code::Blocks Project': ['cbp'] }, openLabel: '添加 .cbp 工程' }); files?.forEach(file => provider.add(file.fsPath)); }));
	context.subscriptions.push(vscode.commands.registerCommand('cbpBuilder.refresh', () => provider.scan()));
	context.subscriptions.push(vscode.commands.registerCommand('cbpBuilder.buildIncremental', (resource?: vscode.Uri) => build(provider, 'incremental', resource)));
	context.subscriptions.push(vscode.commands.registerCommand('cbpBuilder.buildFull', (resource?: vscode.Uri) => build(provider, 'full', resource)));
	context.subscriptions.push(vscode.commands.registerCommand('cbpBuilder.selectMode', async (resource?: BuildResource) => { const selected = await vscode.window.showQuickPick([{ label: '增量编译', mode: 'incremental' as const }, { label: '全量编译', mode: 'full' as const }], { placeHolder: '选择编译方式' }); if (selected) { await build(provider, selected.mode, resource); } }));
	provider.scan();
}

export function deactivate(): void {}
