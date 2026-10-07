import { createClient } from '@supabase/supabase-js';

export interface RAGEnv {
	AI: Ai;
	SUPABASE_URL: string;
	SUPABASE_SERVICE_ROLE_KEY: string;
	SUPABASE_ANON_KEY: string;
	OPENAI_API_KEY: string;
	OPENAI_CHAT_MODEL?: string;
	RAG_MATCH_THRESHOLD?: string;
}

export interface RAGContextItem {
	title: string;
	content: string;
	source: string;
	score?: number;
}

export type ConversationState =
	| 'MAIN_MENU'
	| 'BROWSING_PRODUCTS'
	| 'VIEWING_CART'
	| 'CHECKOUT'
	| 'TRACK_ORDER'
	| 'CUSTOMER_CARE';

export const CONVERSATION_STATES: ConversationState[] = [
	'MAIN_MENU',
	'BROWSING_PRODUCTS',
	'VIEWING_CART',
	'CHECKOUT',
	'TRACK_ORDER',
	'CUSTOMER_CARE',
];

const EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_CHAT_MODEL = 'gpt-4o-mini';
const DEFAULT_MATCH_THRESHOLD = 0.3;
const NO_CONFIDENCE_MESSAGE = "I don't have enough verified information.";

export function normalizeSearchText(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function resolveConversationState(value: string): ConversationState {
	const normalized = value
		.trim()
		.toUpperCase()
		.replace(/[^A-Z_]/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '');

	if (normalized === 'BROWSINGPRODUCTS') {
		return 'BROWSING_PRODUCTS';
	}

	if (normalized === 'VIEWINGCART') {
		return 'VIEWING_CART';
	}

	if (normalized === 'CUSTOMERCARE') {
		return 'CUSTOMER_CARE';
	}

	if (normalized === 'TRACKORDER') {
		return 'TRACK_ORDER';
	}

	if (normalized === 'CHECKOUT') {
		return 'CHECKOUT';
	}

	if (normalized === 'MAIN_MENU' || normalized === 'MAINMENU') {
		return 'MAIN_MENU';
	}

	return 'MAIN_MENU';
}

export function buildContext(context: RAGContextItem[], question: string): string {
	const trimmedQuestion = question.trim();
	const contextText = context
		.slice(0, 5)
		.map((item, index) => {
			const title = item.title?.trim() || `Source ${index + 1}`;
			const source = item.source?.trim() || 'knowledge-base';
			return `Source: ${source}\nTitle: ${title}\nContent: ${item.content.trim()}`;
		})
		.join('\n\n');

	return [
		'You are the Innova Solutions customer-support assistant.',
		'Use only the information in the context below to answer the user.',
		`If the answer is not available in the context, say: "${NO_CONFIDENCE_MESSAGE}"`,
		'Do not invent products, prices, stock availability, order details, payment status, or company policies.',
		'',
		'Context:',
		contextText || 'No verified context was found.',
		'',
		'Question:',
		trimmedQuestion,
	].join('\n');
}

export function buildRAGPrompt(question: string, context: RAGContextItem[]): string {
	return buildContext(context, question);
}

/*
|--------------------------------------------------------------------------
| PDF chunking
|--------------------------------------------------------------------------
| Shared by the ingestion script (scripts/ingest-pdf.ts) and available here
| so both sides of the pipeline chunk text identically.
*/

export function chunkText(text: string, chunkSize = 1000, overlap = 150): string[] {
	const paragraphs = text
		.split(/\n{2,}/)
		.map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
		.filter((paragraph) => paragraph.length > 0);

	const chunks: string[] = [];
	let current = '';

	for (const paragraph of paragraphs) {
		const candidate = current ? `${current}\n\n${paragraph}` : paragraph;

		if (candidate.length <= chunkSize) {
			current = candidate;
			continue;
		}

		if (current) {
			chunks.push(current);
			const tail = current.slice(Math.max(0, current.length - overlap));
			current = `${tail}\n\n${paragraph}`.trim();
		} else {
			current = paragraph;
		}

		while (current.length > chunkSize) {
			chunks.push(current.slice(0, chunkSize));
			current = current.slice(chunkSize - overlap);
		}
	}

	if (current.trim()) {
		chunks.push(current.trim());
	}

	return chunks;
}

/*
|--------------------------------------------------------------------------
| OpenAI helpers
|--------------------------------------------------------------------------
| Plain `fetch` calls (no SDK) to keep the Worker bundle small and match the
| rest of this codebase's style (see the Razorpay integration in commerce.ts).
*/

export async function embedTexts(texts: string[], apiKey: string): Promise<number[][]> {
	if (texts.length === 0) {
		return [];
	}

	const BATCH_SIZE = 96;
	const vectors: number[][] = [];

	for (let offset = 0; offset < texts.length; offset += BATCH_SIZE) {
		const batch = texts.slice(offset, offset + BATCH_SIZE);
		const response = await fetch('https://api.openai.com/v1/embeddings', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: EMBEDDING_MODEL,
				input: batch,
			}),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(`OpenAI embeddings request failed (${response.status}): ${errorBody}`);
		}

		const payload = (await response.json()) as { data: Array<{ embedding: number[]; index: number }> };
		const sorted = [...payload.data].sort((a, b) => a.index - b.index);
		vectors.push(...sorted.map((item) => item.embedding));
	}

	return vectors;
}

export async function embedQuery(query: string, apiKey: string): Promise<number[]> {
	const [vector] = await embedTexts([query], apiKey);
	return vector;
}

async function generateChatAnswer(prompt: string, env: RAGEnv): Promise<string | null> {
	const model = env.OPENAI_CHAT_MODEL || DEFAULT_CHAT_MODEL;

	const response = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.OPENAI_API_KEY}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model,
			messages: [
				{
					role: 'system',
					content: [
						'You are the Innova Solutions WhatsApp commerce assistant.',
						'Answer using only the context provided in the prompt.',
						'Keep the response under 500 characters.',
						`If the answer is not in the context, say exactly: ${NO_CONFIDENCE_MESSAGE}`,
					].join(' '),
				},
				{
					role: 'user',
					content: prompt,
				},
			],
			max_tokens: 220,
			temperature: 0.2,
		}),
	});

	if (!response.ok) {
		const errorBody = await response.text();
		throw new Error(`OpenAI chat completion failed (${response.status}): ${errorBody}`);
	}

	const payload = (await response.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
	};

	return payload.choices?.[0]?.message?.content?.trim() ?? null;
}

/*
|--------------------------------------------------------------------------
| Vector retrieval
|--------------------------------------------------------------------------
*/

interface RagDocumentMatch {
	id: number;
	source: string;
	chunk_index: number;
	content: string;
	metadata: Record<string, unknown> | null;
	similarity: number;
}

export async function retrieveKnowledgeContext(question: string, env: RAGEnv): Promise<RAGContextItem[]> {
	const cleanedQuestion = question.trim();
	if (!cleanedQuestion) {
		return [];
	}

	const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
		auth: {
			persistSession: false,
			autoRefreshToken: false,
		},
	});

	const matchThreshold = env.RAG_MATCH_THRESHOLD ? Number(env.RAG_MATCH_THRESHOLD) : DEFAULT_MATCH_THRESHOLD;
	const queryEmbedding = await embedQuery(cleanedQuestion, env.OPENAI_API_KEY);

	console.log('RAG threshold:', matchThreshold);

	const { data, error } = await supabase.rpc('match_rag_documents', {
		query_embedding: queryEmbedding,
		match_count: 5,
		match_threshold: matchThreshold,
	});

	if (error) {
		console.error('pgvector similarity search failed:', error.message);
		return [];
	}

	const results = (data as RagDocumentMatch[] | null) ?? [];
	console.log('Retrieved chunks:', results.length);
	console.log(results.map((row) => ({ id: row.id, similarity: row.similarity })));

	return results.map((row) => ({
		title: typeof row.metadata?.title === 'string' ? (row.metadata.title as string) : `${row.source} #${row.chunk_index}`,
		content: row.content,
		source: row.source,
		score: row.similarity,
	}));
}

/*
|--------------------------------------------------------------------------
| Answer generation
|--------------------------------------------------------------------------
| question -> embedding -> pgvector similarity search -> top 5 chunks
| -> GPT prompt -> answer. Below the confidence threshold, no GPT call is
| made and the fixed low-confidence message is returned instead.
*/

export async function generateAnswerFromContext(
	question: string,
	context: RAGContextItem[],
	env: RAGEnv
): Promise<string> {
	if (context.length === 0) {
		return NO_CONFIDENCE_MESSAGE;
	}

	const prompt = buildRAGPrompt(question, context);

	try {
		const answer = await generateChatAnswer(prompt, env);
		if (answer) {
			return answer.slice(0, 500);
		}
	} catch (error) {
		console.error('RAG generation failed:', error);
	}

	return NO_CONFIDENCE_MESSAGE;
}

export async function generateAnswer(question: string, env: RAGEnv): Promise<string> {
	const context = await retrieveKnowledgeContext(question, env);
	return generateAnswerFromContext(question, context, env);
}

export async function generateRAGResponse(question: string, env: RAGEnv): Promise<string> {
	return generateAnswer(question, env);
}
