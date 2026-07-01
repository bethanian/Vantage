import { readFileSync } from 'node:fs';
import { constants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import postgres from 'postgres';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export type Check = {
	Name: string;
	Status: CheckStatus;
	Message: string;
};

export function LoadEnvFile(Path: string, Checks: Check[], Required: boolean) {
	try {
		const Content = readFileSync(Path, 'utf8');
		for (const RawLine of Content.split(/\r?\n/)) {
			const Line = RawLine.trim();
			if (!Line || Line.startsWith('#') || !Line.includes('=')) continue;
			const [Key, ...Rest] = Line.split('=');
			if (!process.env[Key]) process.env[Key] = Rest.join('=').trim().replace(/^"|"$/g, '');
		}
		Checks.push({ Name: Path, Status: 'pass', Message: 'loaded' });
	} catch {
		Checks.push({ Name: Path, Status: Required ? 'fail' : 'warn', Message: Required ? 'missing' : 'not present; using process env' });
	}
}

export function CheckEnv(Checks: Check[], Name: string, Required = false) {
	const Value = process.env[Name];
	if (Value) {
		Checks.push({ Name, Status: 'pass', Message: 'set' });
		return;
	}
	Checks.push({ Name, Status: Required ? 'fail' : 'warn', Message: Required ? 'missing' : 'missing; related worker features will be skipped' });
}

export function CheckEnvValue(Checks: Check[], Name: string, Value: string | undefined, Expected: string) {
	if (Value === Expected) {
		Checks.push({ Name, Status: 'pass', Message: Expected });
		return;
	}
	Checks.push({ Name, Status: 'warn', Message: `expected ${Expected}, found ${Value || 'empty'}` });
}

export async function CheckDirectory(Checks: Check[], Name: string, Fallback: string) {
	const Directory = process.env[Name] || Fallback;
	try {
		await mkdir(Directory, { recursive: true });
		await access(Directory, constants.W_OK);
		Checks.push({ Name, Status: 'pass', Message: resolve(Directory) });
	} catch (Reason) {
		const Message = Reason instanceof Error ? Reason.message : 'not writable';
		Checks.push({ Name, Status: 'fail', Message });
	}
}

export function CheckTool(Checks: Check[], Name: string, Required = true) {
	const Command = process.platform === 'win32' ? 'where' : 'which';
	const Result = spawnSync(Command, [Name], { encoding: 'utf8', shell: false });
	if (Result.status === 0) {
		Checks.push({ Name, Status: 'pass', Message: Result.stdout.split(/\r?\n/)[0] });
		return;
	}
	Checks.push({ Name, Status: Required ? 'fail' : 'warn', Message: 'not found in PATH' });
}

export async function CheckPostgres(Checks: Check[]) {
	const Url = process.env.POSTGRES_URL;
	if (!Url) return;
	const Sql = postgres(Url, { max: 1, idle_timeout: 1, connect_timeout: 8 });
	try {
		await Sql`select 1`;
		Checks.push({ Name: 'Postgres connection', Status: 'pass', Message: 'reachable' });
	} catch (Reason) {
		const Message = Reason instanceof Error ? Reason.message : 'connection failed';
		Checks.push({ Name: 'Postgres connection', Status: 'fail', Message });
	} finally {
		await Sql.end({ timeout: 1 }).catch(() => undefined);
	}
}

export function PrintChecks(Checks: Check[]) {
	for (const Check of Checks) console.log(`${Icon(Check.Status)} ${Check.Name}: ${Check.Message}`);
	const Failed = Checks.filter((Check) => Check.Status === 'fail').length;
	const Warned = Checks.filter((Check) => Check.Status === 'warn').length;
	console.log(JSON.stringify({ Status: Failed ? 'Failed' : Warned ? 'ReadyWithWarnings' : 'Ready', Failed, Warned }, null, 2));
	if (Failed) process.exit(1);
}

function Icon(Status: CheckStatus) {
	if (Status === 'pass') return '[OK]';
	if (Status === 'warn') return '[WARN]';
	return '[FAIL]';
}
