import { createClient } from '@supabase/supabase-js';

export interface RAGEnv {
	AI: Ai;
	SUPABASE_URL: string;
	SUPABASE_SERVICE_ROLE_KEY: string;
	SUPABASE_ANON_KEY: string;
}

export interface KnowledgeDoc {
	id?: number;
	title: string;
	content: string;
	source_type?: string;
	category?: string;
	product_id?: number | null;
	score?: number;
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
		'If the answer is not available in the context, say: "I do not have verified information for that yet."',
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

export function extractAIText(result: unknown): string | null {
	if (!result || typeof result !== 'object') {
		return null;
	}

	const record = result as Record<string, unknown>;

	if (typeof record.response === 'string' && record.response.trim().length > 0) {
		return record.response.trim();
	}

	if (typeof record.answer === 'string' && record.answer.trim().length > 0) {
		return record.answer.trim();
	}

	if (Array.isArray(record.output)) {
		const outputText = record.output
			.map((entry) => {
				if (typeof entry === 'string') {
					return entry;
				}

				if (entry && typeof entry === 'object') {
					const outputEntry = entry as Record<string, unknown>;
					if (typeof outputEntry.text === 'string') {
						return outputEntry.text;
					}
				}

				return '';
			})
			.join('')
			.trim();

		if (outputText.length > 0) {
			return outputText;
		}
	}

	return null;
}

async function searchKnowledgeBaseTable(
	query: string,
	env: RAGEnv,
	limit = 5
): Promise<RAGContextItem[]> {
	const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
		auth: {
			persistSession: false,
			autoRefreshToken: false,
		},
	});

	const searchTerms = normalizeSearchText(query)
		.split(' ')
		.filter((term) => term.length > 2)
		.slice(0, 6);

	if (searchTerms.length === 0) {
		return [];
	}

	const orClause = searchTerms
		.map((term) => `title.ilike.%${term}%,content.ilike.%${term}%`)
		.join(',');

	const { data, error } = await supabase
		.from('knowledge_base')
		.select('id, title, content, source_type, category')
		.or(orClause)
		.limit(limit);

	if (error) {
		console.warn('Knowledge base search failed:', error.message);
		return [];
	}

	if (!data || data.length === 0) {
		return [];
	}

	return (data as KnowledgeDoc[]).map((item) => ({
		title: item.title || 'Knowledge article',
		content: item.content || '',
		source: item.source_type || item.category || 'knowledge-base',
		score: 1,
	}));
}

async function searchProductFallback(query: string, env: RAGEnv, limit = 5): Promise<RAGContextItem[]> {
	const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
		auth: {
			persistSession: false,
			autoRefreshToken: false,
		},
	});

	const searchTerms = normalizeSearchText(query)
		.split(' ')
		.filter((term) => term.length > 2)
		.slice(0, 6);

	if (searchTerms.length === 0) {
		return [];
	}

	const orClause = searchTerms
		.map((term) => `name.ilike.%${term}%,description.ilike.%${term}%`)
		.join(',');

	const { data, error } = await supabase
		.from('products')
		.select('id, name, description, price')
		.or(orClause)
		.limit(limit);

	if (error || !data || data.length === 0) {
		return [];
	}

	return (data as Array<{ id: number; name: string; description: string | null; price: number }>).map(
		(item) => ({
			title: item.name,
			content: item.description
				? `${item.name}: ${item.description}. Price: ₹${item.price}.`
				: `${item.name}: price ₹${item.price}.`,
			source: 'products',
			score: 1,
		})
	);
}

export async function searchKnowledgeBase(
	query: string,
	env: RAGEnv,
	limit = 5
): Promise<RAGContextItem[]> {
	const cleanedQuestion = query.trim();
	if (!cleanedQuestion) {
		return [];
	}
	
	const fromKnowledgeBase = await searchKnowledgeBaseTable(cleanedQuestion, env, limit);
	if (fromKnowledgeBase.length > 0) {
		return fromKnowledgeBase;
	}
	
	return searchProductFallback(cleanedQuestion, env, limit);
}

export async function retrieveKnowledgeContext(question: string, env: RAGEnv): Promise<RAGContextItem[]> {
	return searchKnowledgeBase(question, env, 5);
}

export async function generateAnswer(question: string, env: RAGEnv): Promise<string> {
	const context = await retrieveKnowledgeContext(question, env);
	if (context.length === 0) {
		return 'I do not have verified information for that yet. Please contact Customer Care for assistance.';
	}

	const prompt = buildRAGPrompt(question, context);

	try {
		const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
			messages: [
				{
					role: 'system',
					content: [
						'You are the Innova Solutions WhatsApp commerce assistant.',
						'Answer using only the context provided.',
						'Keep the response under 500 characters.',
						'If the answer is not in the context, say: I do not have verified information for that yet.',
					].join(' '),
				},
				{
					role: 'user',
					content: prompt,
				},
			],
			max_tokens: 180,
		});

		const aiText = extractAIText(result);
		if (aiText) {
			return aiText.trim().slice(0, 500);
		}
	} catch (error) {
		console.error('RAG generation failed:', error);
	}

	return context
		.slice(0, 1)
		.map((item) => `${item.title}: ${item.content}`)
		.join('\n')
		.slice(0, 500);
}

export async function generateRAGResponse(question: string, env: RAGEnv): Promise<string> {
	return generateAnswer(question, env);
}
