import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(__dirname, '../../app/js/state.js'), 'utf8');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

export const answerFieldKey     = sandbox.answerFieldKey;
export const likertFieldKey     = sandbox.likertFieldKey;
export const celebratedIDBKey   = sandbox.celebratedIDBKey;
export const starFieldKey       = sandbox.starFieldKey;
export const chapterAnswersIDBKey = sandbox.chapterAnswersIDBKey;
