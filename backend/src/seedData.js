import zlib from 'node:zlib';

// Demo catalogue: 12 products in 3 categories. Prices are rupee strings (converted to paise by the seed).
export const PRODUCTS = [
  { name: 'Wireless Headphones', category: 'Electronics', price: '2499.00', stock: 40, color: [37, 99, 235], description: 'Over-ear Bluetooth headphones with 30 hour battery life and active noise reduction.' },
  { name: 'Mechanical Keyboard', category: 'Electronics', price: '3799.00', stock: 25, color: [79, 70, 229], description: 'Compact 75% mechanical keyboard with hot-swappable switches and white backlight.' },
  { name: 'Portable Power Bank 20000mAh', category: 'Electronics', price: '1799.50', stock: 60, color: [14, 116, 144], description: 'Fast-charging 20000mAh power bank with two USB-A ports and one USB-C port.' },
  { name: 'Smart Fitness Band', category: 'Electronics', price: '1999.00', stock: 8, color: [190, 24, 93], description: 'Water resistant fitness band with heart rate, sleep tracking and a 14 day battery.' },
  { name: 'The Pragmatic Programmer', category: 'Books', price: '899.00', stock: 30, color: [180, 83, 9], description: 'Classic guide to software craftsmanship, 20th anniversary edition, paperback.' },
  { name: 'Atomic Habits', category: 'Books', price: '499.00', stock: 100, color: [217, 119, 6], description: 'A practical guide to building good habits and breaking bad ones, paperback.' },
  { name: 'Clean Code', category: 'Books', price: '1150.00', stock: 20, color: [161, 98, 7], description: 'A handbook of agile software craftsmanship by Robert C. Martin, paperback.' },
  { name: 'Designing Data-Intensive Applications', category: 'Books', price: '1899.00', stock: 15, color: [146, 64, 14], description: 'The big ideas behind reliable, scalable and maintainable data systems.' },
  { name: 'Ceramic Coffee Mug Set', category: 'Home', price: '699.00', stock: 50, color: [22, 163, 74], description: 'Set of four 350 ml stoneware mugs, microwave and dishwasher safe.' },
  { name: 'Cotton Bath Towel', category: 'Home', price: '549.00', stock: 75, color: [13, 148, 136], description: 'Soft 600 GSM cotton bath towel, 70 x 140 cm, quick drying.' },
  { name: 'LED Desk Lamp', category: 'Home', price: '1299.00', stock: 35, color: [101, 163, 13], description: 'Dimmable LED desk lamp with three colour temperatures and a USB charging port.' },
  { name: 'Non-Stick Frying Pan', category: 'Home', price: '999.00', stock: 4, color: [5, 150, 105], description: '28 cm induction-ready non-stick frying pan with a heat-resistant handle.' },
];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

const mix = (a, b, t) => Math.round(a + (b - a) * t);

// A real 480x360 PNG: a diagonal gradient from the product colour to a darker shade, with a pale disc
// whose position depends on `variant`, so every product (and each of its images) looks different.
export function makePng([r, g, b], variant = 0) {
  const width = 480;
  const height = 360;
  const cx = width * (0.3 + 0.2 * variant);
  const cy = height * 0.5;
  const radius = 90;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      let pixel = [mix(r, r * 0.35, t), mix(g, g * 0.35, t), mix(b, b * 0.35, t)];
      if ((x - cx) ** 2 + (y - cy) ** 2 < radius ** 2) pixel = pixel.map((v) => mix(v, 255, 0.75));
      raw.set(pixel, row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
