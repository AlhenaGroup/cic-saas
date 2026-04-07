const SUPABASE_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA';

async function downloadFile(filePath) {
  const url = `${SUPABASE_URL}/storage/v1/object/documents/${filePath}`;
  const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + SUPABASE_KEY } });
  if (!res.ok) throw new Error('Download failed: ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

function parsePDF(buffer) {
  const pdfParse = require('pdf-parse');
  return pdfParse(buffer).then(data => data.text);
}

function parseExcel(buffer) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const texts = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    texts.push(XLSX.utils.sheet_to_csv(sheet));
  }
  return texts.join('\n');
}

function parseWord(buffer) {
  const mammoth = require('mammoth');
  return mammoth.extractRawText({ buffer }).then(r => r.value);
}

function extractPayslipData(text) {
  const result = {};
  // Nome dipendente (pattern italiano busta paga)
  const nameMatch = text.match(/(?:COGNOME\s+NOME|DIPENDENTE|LAVORATORE)[:\s]*([A-Z][A-Z\s]+)/i);
  if (nameMatch) result.nome = nameMatch[1].trim();
  // Codice fiscale
  const cfMatch = text.match(/(?:C\.?F\.?|COD\.?\s*FISC\.?)[:\s]*([A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z]\d{3}[A-Z])/i);
  if (cfMatch) result.cf = cfMatch[1];
  // Mese riferimento
  const meseMatch = text.match(/(?:MESE|PERIODO|COMPETENZA)[:\s]*(?:DI\s+)?(\w+)\s+(\d{4})/i);
  if (meseMatch) {
    const mesi = { GENNAIO: '01', FEBBRAIO: '02', MARZO: '03', APRILE: '04', MAGGIO: '05', GIUGNO: '06', LUGLIO: '07', AGOSTO: '08', SETTEMBRE: '09', OTTOBRE: '10', NOVEMBRE: '11', DICEMBRE: '12' };
    const m = mesi[meseMatch[1].toUpperCase()];
    if (m) result.mese = meseMatch[2] + '-' + m;
  }
  // Mese numerico
  if (!result.mese) {
    const meseNum = text.match(/(\d{2})[\/\-](\d{4})/);
    if (meseNum) result.mese = meseNum[2] + '-' + meseNum[1];
  }
  // Retribuzione lorda
  const lordoMatch = text.match(/(?:TOTALE\s+COMPETENZE|RETRIBUZIONE\s+LORDA|IMPONIBILE\s+PREVIDENZIALE)[:\s]*[€]?\s*([\d.,]+)/i);
  if (lordoMatch) result.lordo = parseFloat(lordoMatch[1].replace(/\./g, '').replace(',', '.'));
  // Retribuzione netta
  const nettoMatch = text.match(/(?:NETTO\s+IN\s+BUSTA|NETTO\s+A\s+PAGARE|NETTO\s+DA\s+CORRISPONDERE)[:\s]*[€]?\s*([\d.,]+)/i);
  if (nettoMatch) result.netto = parseFloat(nettoMatch[1].replace(/\./g, '').replace(',', '.'));
  // Costo azienda
  const costoMatch = text.match(/(?:COSTO\s+AZIEND|COSTO\s+DEL\s+LAVORO|TOTALE\s+COSTO)[:\s]*[€]?\s*([\d.,]+)/i);
  if (costoMatch) result.costo_azienda = parseFloat(costoMatch[1].replace(/\./g, '').replace(',', '.'));
  // Ore lavorate
  const oreMatch = text.match(/(?:ORE\s+ORDINARIE|ORE\s+LAVORATE|TOT\.?\s+ORE)[:\s]*([\d.,]+)/i);
  if (oreMatch) result.ore = parseFloat(oreMatch[1].replace(',', '.'));

  return result;
}

function extractContractData(text) {
  const result = {};
  const nameMatch = text.match(/(?:SIGNOR|SIG\.?|LAVORATORE|DIPENDENTE)[:\s]*([A-Z][A-Za-z\s]+?)(?:\s*nato|,|\n)/i);
  if (nameMatch) result.nome = nameMatch[1].trim();
  const cfMatch = text.match(/([A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z]\d{3}[A-Z])/);
  if (cfMatch) result.cf = cfMatch[1];
  const tipoMatch = text.match(/(?:CONTRATTO\s+A\s+TEMPO\s+)(INDETERMINATO|DETERMINATO)/i);
  if (tipoMatch) result.tipo_contratto = 'tempo_' + tipoMatch[1].toLowerCase();
  const livelloMatch = text.match(/(?:LIVELLO|INQUADRAMENTO)[:\s]*(\S+)/i);
  if (livelloMatch) result.livello = livelloMatch[1];
  const dataMatch = text.match(/(?:DECORRENZA|DAL|DATA\s+ASSUNZIONE)[:\s]*(\d{2})[\/\-](\d{2})[\/\-](\d{4})/i);
  if (dataMatch) result.data_assunzione = dataMatch[3] + '-' + dataMatch[2] + '-' + dataMatch[1];
  const oreMatch = text.match(/(?:ORE\s+SETTIMANALI|ORARIO\s+DI\s+LAVORO)[:\s]*([\d]+)/i);
  if (oreMatch) result.ore_contrattuali = parseInt(oreMatch[1]);

  return result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { file_path, doc_id, doc_type } = req.body || {};
  if (!file_path) return res.status(400).json({ error: 'file_path required' });

  try {
    const buffer = await downloadFile(file_path);
    const ext = file_path.split('.').pop().toLowerCase();

    let text = '';
    if (ext === 'pdf') text = await parsePDF(buffer);
    else if (['xlsx', 'xls', 'csv'].includes(ext)) text = parseExcel(buffer);
    else if (['doc', 'docx'].includes(ext)) text = await parseWord(buffer);
    else return res.status(400).json({ error: 'Formato non supportato: ' + ext });

    // Determina tipo e parsa
    const isPayslip = doc_type === 'Busta paga' || /busta\s*paga|cedolino|competenze/i.test(text);
    const parsed = isPayslip ? extractPayslipData(text) : extractContractData(text);
    parsed.type = isPayslip ? 'busta_paga' : 'contratto';
    parsed.text_preview = text.substring(0, 500);

    // Aggiorna documento in DB
    if (doc_id) {
      const updateFields = {
        parsed_data: parsed,
        parse_status: Object.keys(parsed).length > 2 ? 'parsed' : 'failed'
      };
      if (parsed.lordo) updateFields.importo_lordo = parsed.lordo;
      if (parsed.netto) updateFields.importo_netto = parsed.netto;
      if (parsed.mese) updateFields.mese_riferimento = parsed.mese + '-01';

      await fetch(`${SUPABASE_URL}/rest/v1/employee_documents?id=eq.${doc_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Prefer': 'return=minimal' },
        body: JSON.stringify(updateFields)
      });
    }

    return res.status(200).json({ ok: true, parsed, isPayslip });
  } catch (err) {
    console.error('[PARSE ERROR]', err.message);
    if (doc_id) {
      await fetch(`${SUPABASE_URL}/rest/v1/employee_documents?id=eq.${doc_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ parse_status: 'failed', parsed_data: { error: err.message } })
      });
    }
    return res.status(500).json({ error: err.message });
  }
}
