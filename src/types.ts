export type Granularity = 'sentence' | 'twoThreeSentences' | 'paragraph';

export interface InkflowSettings {
	ollamaUrl: string;
	modelName: string;
	idleSeconds: number;
	contextLength: number;
	suggestionCount: number;
	granularity: Granularity;
	systemPrompt: string;
	timeoutMs: number;
	enabled: boolean;
}

// Default System Prompt, taken verbatim from the MVP specification (§4).
export const DEFAULT_SYSTEM_PROMPT = `あなたは小説・エッセイ・ブログなどの執筆をサポートするアシスタントです。

【作品情報】
{frontmatter}

【ルール】
- ユーザーの文体・語調・視点を維持してください
- 提案のみを出力し、説明・コメントは一切含めないでください
- 日本語で出力してください
- 物語の方向性を決定づけるような大きな展開は避けてください
- 地の文であれば地の文で、会話であれば会話で続けてください`;

export const DEFAULT_SETTINGS: InkflowSettings = {
	ollamaUrl: 'http://localhost:11434',
	modelName: 'llama3',
	idleSeconds: 3,
	contextLength: 2000,
	suggestionCount: 3,
	granularity: 'sentence',
	systemPrompt: DEFAULT_SYSTEM_PROMPT,
	timeoutMs: 30000,
	enabled: true,
};

export const VIEW_TYPE_INKFLOW = 'inkflow-suggestion-panel';

// Granularity expansion phrases inserted into the User Prompt (spec §4).
export const GRANULARITY_PROMPTS: Record<Granularity, string> = {
	sentence: '一文（句点まで）で提案してください',
	twoThreeSentences: '2〜3文、50〜100文字程度で提案してください',
	paragraph: '一段落（改行で終わる）で提案してください',
};

// Human-readable labels for the granularity dropdown in settings.
export const GRANULARITY_LABELS: Record<Granularity, string> = {
	sentence: '一文',
	twoThreeSentences: '二〜三文',
	paragraph: '一段落',
};

export type PanelStatus = 'idle' | 'loading' | 'done' | 'error';

export interface PanelState {
	status: PanelStatus;
	suggestions?: string[];
	error?: string;
}
