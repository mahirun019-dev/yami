import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function aboutBuildMetadata(root: string, env: Record<string, string | undefined>) {
  let commit: string | null = env.GITHUB_SHA || null;
  if (!commit) {
    try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { commit = null; }
  }
  if (!commit || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(commit)) commit = null;
  const licenseName = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'].find((name) => existsSync(resolve(root, name)));
  const projectLicense = licenseName ? { filename: licenseName, text: readFileSync(resolve(root, licenseName), 'utf8') } : null;
  const dependencies = ['react', 'react-dom', 'lucide-react', '@phosphor-icons/react', '@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'].map((name) => {
    const directory = resolve(root, 'node_modules', name);
    const pkg = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
    return { name, version: String(pkg.version), license: String(pkg.license || ''), text: readFileSync(resolve(directory, 'LICENSE'), 'utf8') };
  });
  return { commit, projectLicense, dependencies };
}
