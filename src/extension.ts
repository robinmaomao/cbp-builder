// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

type BuildMode = 'incremental' | 'full';
interface CbpProject { file: string; title: string; compiler: string; target: string; files: string[]; compileOptions: string[]; includeDirectories: string[]; linkOptions: string[]; libraries: string[]; }

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
		this.refresh();
	}
	add(file: string): void { const project = parseCbp(file); if (project && !this.projects.some(item => item.file === project.file)) {this.projects.push(project);} this.refresh(); }
}

function parseCbp(file: string): CbpProject | undefined {
	try {
		const xml = fs.readFileSync(file, 'utf8');
		const compilerBlock = xml.match(/<Compiler>([\s\S]*?)<\/Compiler>/)?.[1] ?? '';
		const linkerBlock = xml.match(/<Linker>([\s\S]*?)<\/Linker>/)?.[1] ?? '';
		return { file, title: xml.match(/<Option\s+title="([^"]+)"/)?.[1] ?? path.basename(file, '.cbp'), compiler: xml.match(/<Option\s+compiler="([^"]+)"/)?.[1] ?? '', target: xml.match(/<Target\s+title="([^"]+)"/)?.[1] ?? 'Debug', files: [...xml.matchAll(/<Unit\s+filename="([^"]+)"/g)].map(match => match[1]), compileOptions: [...compilerBlock.matchAll(/<Add\s+option="([^"]+)"/g)].map(match => match[1]), includeDirectories: [...compilerBlock.matchAll(/<Add\s+directory="([^"]+)"/g)].map(match => match[1]), linkOptions: [...linkerBlock.matchAll(/<Add\s+option="([^"]+)"/g)].map(match => match[1]), libraries: [...linkerBlock.matchAll(/<Add\s+library="([^"]+)"/g)].map(match => match[1]) };
	} catch { return undefined; }
}

function findToolchain(): string | undefined {
	const configured = vscode.workspace.getConfiguration('cbpBuilder').get<string[]>('toolchainSearchPaths', []);
	const roots = ['C:/Program Files (x86)/RV32-Toolchain', 'C:/Program Files/RV32-Toolchain', 'C:/RV32-Toolchain', 'D:/RV32-Toolchain', ...configured, process.env.TOOLCHAIN_DIR ?? ''];
	const candidates = [...roots.flatMap(root => [root, path.join(root, 'bin'), path.join(root, 'RV32-V2', 'bin'), path.join(root, 'RV32-V2')]), ...(process.env.PATH ?? '').split(path.delimiter)];
	return candidates.filter(Boolean).find(candidate => {
		try { return fs.readdirSync(candidate).some(file => /^(mingw32-make|make|riscv32-elf-(gcc|xmaker))(\.exe)?$/i.test(file)); } catch { return false; }
	});
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
	const make = vscode.workspace.getConfiguration('cbpBuilder').get<string>('makeCommand', 'mingw32-make');
	const toolchain = findToolchain();
	const output = vscode.window.createOutputChannel('CBP Builder');
	output.show(true);
	output.appendLine(`[CBP Builder] ${mode === 'full' ? '全量' : '增量'}编译: ${project.file}`);
	output.appendLine(`[CBP Builder] 工具链: ${toolchain ?? '默认环境'}`);
	const env = { ...process.env, ...(toolchain ? { PATH: `${toolchain}${path.delimiter}${process.env.PATH ?? ''}` } : {}) };
	const run = (args: string[]) => new Promise<number>(resolve => { const child = cp.spawn(make, args, { cwd: path.dirname(project.file), env, shell: true }); child.stdout.on('data', data => output.append(data.toString())); child.stderr.on('data', data => output.append(data.toString())); child.on('close', code => resolve(code ?? 1)); });
	const cleanCode = mode === 'full' ? await run(['clean']) : 0;
	const code = cleanCode === 0 ? await run([]) : cleanCode;
	provider.lastResult = code === 0 ? `成功 (${new Date().toLocaleTimeString()})` : `失败，退出码 ${code}`;
	provider.refresh();
	if (code === 0) {vscode.window.showInformationMessage(`${project.title} 编译成功`);} else {vscode.window.showErrorMessage(`${project.title} 编译失败，请查看 CBP Builder 输出`);}
}

export function activate(context: vscode.ExtensionContext): void {
	const provider = new ProjectProvider();
	context.subscriptions.push(vscode.window.registerTreeDataProvider('cbpBuilder.projects', provider));
	context.subscriptions.push(vscode.commands.registerCommand('cbpBuilder.addProject', async () => { const files = await vscode.window.showOpenDialog({ canSelectMany: true, filters: { 'Code::Blocks Project': ['cbp'] }, openLabel: '添加 .cbp 工程' }); files?.forEach(file => provider.add(file.fsPath)); }));
	context.subscriptions.push(vscode.commands.registerCommand('cbpBuilder.refresh', () => provider.scan()));
	context.subscriptions.push(vscode.commands.registerCommand('cbpBuilder.buildIncremental', (resource?: vscode.Uri) => build(provider, 'incremental', resource)));
	context.subscriptions.push(vscode.commands.registerCommand('cbpBuilder.buildFull', (resource?: vscode.Uri) => build(provider, 'full', resource)));
	context.subscriptions.push(vscode.commands.registerCommand('cbpBuilder.selectMode', async () => { const selected = await vscode.window.showQuickPick([{ label: '增量编译', mode: 'incremental' as const }, { label: '全量编译', mode: 'full' as const }]); if (selected) { provider.mode = selected.mode; provider.refresh(); } }));
	provider.scan();
}

export function deactivate(): void {}
