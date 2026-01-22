const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
	console.error('Missing SUPABASE_URL or SUPABASE key in environment');
	process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const documentId = process.argv[2];
if (!documentId) {
	console.error('Usage: node get_document.js <documentId>');
	process.exit(2);
}

(async () => {
	try {
		console.log('Fetching document', documentId);
		const { data, error } = await supabase.from('documents').select('*').eq('id', documentId).single();
		if (error) {
			console.error('DB_ERROR', JSON.stringify(error, null, 2));
			process.exit(1);
		}
		console.log('DOCUMENT:', JSON.stringify(data, null, 2));
		process.exit(0);
	} catch (e) {
		console.error('UNEXPECTED_ERROR', e && e.message ? e.message : String(e));
		process.exit(1);
	}
})();

