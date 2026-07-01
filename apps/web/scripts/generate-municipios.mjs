/**
 * Genera apps/web/public/data/municipios.json
 *
 * Fuente: INE — Instituto Nacional de Estadística
 *   Relación de municipios y sus códigos por provincias (Padrón Municipal)
 *   https://www.ine.es/dyngs/INEbase/es/operacion.htm?c=Estadistica_C&cid=1254736177031
 *
 * Intermediario: codeforspain/ds-organizacion-administrativa (GitHub)
 *   Derivado estructurado de los ficheros CODMUN del INE.
 *
 * Licencia: Datos del sector público español reutilizables bajo
 *   Ley 37/2007 de Reutilización de la Información del Sector Público.
 *   Cita de fuente requerida: "Fuente: INE"
 *
 * Run: node apps/web/scripts/generate-municipios.mjs
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE =
  'https://raw.githubusercontent.com/codeforspain/ds-organizacion-administrativa/master/data';

/**
 * El CSV del repo tiene un Mojibake puntual en "Coruña, A" (y potencialmente otros):
 * los bytes UTF-8 de 2 bytes (C0-DF + 80-BF) están almacenados como dos chars Latin-1.
 * Esta función detecta ese patrón y lo corrige.
 */
function repairMojibake(str) {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const c1 = str.charCodeAt(i);
    const c2 = str.charCodeAt(i + 1);
    if (c1 >= 0xc0 && c1 <= 0xdf && c2 >= 0x80 && c2 <= 0xbf) {
      result += String.fromCodePoint(((c1 & 0x1f) << 6) | (c2 & 0x3f));
      i++;
    } else {
      result += str[i];
    }
  }
  return result;
}

/**
 * Normaliza nombres de provincia en forma invertida de ordenación
 * que usa el INE: "Coruña, A" → "A Coruña", "Rioja, La" → "La Rioja".
 */
function normalizeProvinceName(name) {
  const fixed = repairMojibake(name);
  const match = fixed.match(/^(.+), (.+)$/);
  if (match) return `${match[2]} ${match[1]}`;
  return fixed;
}

/**
 * Parser CSV robusto con soporte de campos entre comillas.
 * El INE usa comillas para campos con comas (p. ej. "Coruña, A").
 */
function parseCSVLine(line) {
  const values = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      values.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  values.push(cur);
  return values;
}

function parseCsv(text) {
  const rawLines = text.trim().split('\n');
  const headers = parseCSVLine(rawLines[0]).map((h) => h.trim());
  return rawLines.slice(1).map((line) => {
    const cols = parseCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, (cols[i] ?? '').trim()]));
  });
}

/** Fetch como bytes y decodifica explícitamente en UTF-8 para evitar mojibake. */
async function fetchText(url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return new TextDecoder('utf-8').decode(buf);
}

async function main() {
  console.log('Fetching provincias…');
  const provinciasText = await fetchText(`${BASE}/provincias.csv`);
  const provinciasRaw = parseCsv(provinciasText);
  const provinciaMap = new Map(
    provinciasRaw.map((p) => [p['provincia_id'], normalizeProvinceName(p['nombre'])]),
  );
  console.log(`  ${provinciaMap.size} provincias loaded`);

  console.log('Fetching municipios…');
  const municipiosText = await fetchText(`${BASE}/municipios.csv`);
  const municipiosRaw = parseCsv(municipiosText);

  const municipios = municipiosRaw
    .map((m) => ({
      name: m['nombre'],
      province: provinciaMap.get(m['provincia_id']) ?? '',
    }))
    .filter((m) => m.name && m.province)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const outDir = join(__dirname, '..', 'public', 'data');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'municipios.json');
  writeFileSync(outPath, JSON.stringify(municipios), 'utf8');

  console.log(`Generated ${municipios.length} municipios -> ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
