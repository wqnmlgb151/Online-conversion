const zlib = require('node:zlib');
const XLSX = require('../../vendor/xlsx/xlsx.full.min.js');
const JSZip = require('../../vendor/jszip/jszip.min.js');

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const data = Buffer.concat([Buffer.from(type), bytes]);
  const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(data));
  return Buffer.concat([size, data, crc]);
}
function png() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(4, 0); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 6;
  // Fully transparent RGBA, used to verify the JPEG white background.
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.alloc(34))), chunk('IEND', Buffer.alloc(0))]);
}
function pdf(pages = 2, pageSize = 300) {
  const objects = [];
  const add = text => { objects.push(text); return objects.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(`<< /Type /Pages /Count ${pages} /Kids [${Array.from({length:pages},(_,i)=>`${4+i*2} 0 R`).join(' ')}] >>`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let i = 0; i < pages; i++) {
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageSize} ${pageSize}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`);
    const content = `BT /F1 16 Tf 20 250 Td (Page ${i+1} sample) Tj ET`;
    add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  let result = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((text, i) => { offsets.push(Buffer.byteLength(result)); result += `${i+1} 0 obj\n${text}\nendobj\n`; });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  result += offsets.slice(1).map(n => `${String(n).padStart(10,'0')} 00000 n \n`).join('');
  result += `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(result);
}
function xlsx() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['名称','数量'],['苹果',3],['梨',5]]), '数据');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['不应导出第二个工作表']]), '其他');
  return Buffer.from(XLSX.write(workbook, {type:'buffer', bookType:'xlsx'}));
}
async function docx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>中文文档转换验证</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>');
  return zip.generateAsync({type:'nodebuffer'});
}
function wav() {
  const samples = 8000, data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length-8,4); data.write('WAVE',8); data.write('fmt ',12);
  data.writeUInt32LE(16,16); data.writeUInt16LE(1,20); data.writeUInt16LE(1,22);
  data.writeUInt32LE(8000,24); data.writeUInt32LE(16000,28); data.writeUInt16LE(2,32); data.writeUInt16LE(16,34);
  data.write('data',36); data.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++) data.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/8000)*3000),44+i*2);
  return data;
}
async function openImageOptions(page) {
  const options = page.locator('#img-options');
  if (await options.getAttribute('open') === null) await options.locator('summary').click();
}
module.exports = { png, pdf, xlsx, docx, wav, openImageOptions };
