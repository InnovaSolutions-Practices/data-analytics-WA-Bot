/**
 * PDF ingestion pipeline for the pgvector RAG store.
 *
 * Usage:
 *   npm run ingest -- <path-to-pdf-or-directory> [--source=<name>]
 *
 * Examples:
 *   npm run ingest -- ./docs/warranty-policy.pdf
 *   npm run ingest -- ./docs                # ingests every *.pdf in the folder
 *
 * New PDFs are ingestible by dropping a file into the target folder and
 * re-running this command — no code changes required. Re-running against an
 * already-ingested file replaces its chunks (matched by `source`), so
 * updated PDFs can be re-ingested safely.
 *
 * Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and OPENAI_API_KEY in the
 * environment (or a .env file in the project root).
 */

import 'dotenv/config';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// pdf-parse ships as CommonJS; default import works under esModuleInterop.
import pdfParse from 'pdf-parse';
import { chunkText, embedTexts } from '../src/rag';

interface IngestArgs {
	target: string;
	sourceOverride?: string;
}

function parseArgs(argv: string[]): IngestArgs {
	const positional = argv.filter((arg) => !arg.startsWith('--'));
	const sourceFlag = argv.find((arg) => arg.startsWith('--source='));

	if (!positional.length) {
		throw new Error('Usage: npm run ingest -- <path-to-pdf-or-directory> [--source=<name>]');
	}

	return {
		target: positional[0],
		sourceOverride: sourceFlag?.slice('--source='.length),
	};
}

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

async function collectPdfFiles(target: string): Promise<string[]> {
	const targetStat = await stat(target);

	if (targetStat.isFile()) {
		if (!target.toLowerCase().endsWith('.pdf')) {
			throw new Error(`Not a PDF file: ${target}`);
		}
		return [target];
	}

	const entries = await readdir(target, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
		.map((entry) => path.join(target, entry.name))
		.sort();
}

async function ingestPdf(
	filePath: string,
	supabase: SupabaseClient,
	openaiApiKey: string,
	sourceOverride?: string
): Promise<void> {
	const source = sourceOverride ?? path.basename(filePath);
	console.log(`\n[ingest] ${source}`);

	const fileBuffer = await readFile(filePath);
	const parsed = await pdfParse(fileBuffer);
	const text = parsed.text.trim();

	if (!text) {
		console.warn(`[ingest] Skipping ${source}: no extractable text (scanned/image-only PDF?)`);
		return;
	}

	const chunks = chunkText(text);
	console.log(`[ingest] Extracted ${text.length} chars -> ${chunks.length} chunks`);

	if (chunks.length === 0) {
		return;
	}

	const embeddings = await embedTexts(chunks, openaiApiKey);

	// Replace this source's existing chunks so re-ingesting an updated PDF
	// doesn't leave stale trailing rows behind if the chunk count shrank.
	const { error: deleteError } = await supabase.from('rag_documents').delete().eq('source', source);
	if (deleteError) {
		throw new Error(`Failed to clear previous chunks for ${source}: ${deleteError.message}`);
	}

	const rows = chunks.map((content, index) => ({
		source,
		chunk_index: index,
		content,
		embedding: embeddings[index],
		metadata: { title: source, pages: parsed.numpages },
	}));

	const { error: insertError } = await supabase.from('rag_documents').insert(rows);
	if (insertError) {
		throw new Error(`Failed to insert chunks for ${source}: ${insertError.message}`);
	}

	console.log(`[ingest] Stored ${rows.length} chunks for ${source}`);
}

async function main(): Promise<void> {
	const { target, sourceOverride } = parseArgs(process.argv.slice(2));

	const supabaseUrl = requireEnv('SUPABASE_URL');
	const supabaseServiceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
	const openaiApiKey = requireEnv('OPENAI_API_KEY');

	const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});

	const pdfFiles = await collectPdfFiles(target);
	if (pdfFiles.length === 0) {
		console.warn(`No PDF files found at ${target}`);
		return;
	}

	if (pdfFiles.length > 1 && sourceOverride) {
		throw new Error('--source can only be used when ingesting a single PDF file');
	}

	for (const filePath of pdfFiles) {
		await ingestPdf(filePath, supabase, openaiApiKey, sourceOverride);
	}

	console.log(`\n[ingest] Done. Ingested ${pdfFiles.length} file(s).`);
}

main().catch((error) => {
	console.error('[ingest] Failed:', error);
	process.exitCode = 1;
});
