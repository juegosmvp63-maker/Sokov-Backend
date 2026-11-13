import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const uploadsDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

let localOrders = [];
let bankReferences = new Set();

const PORT = process.env.PORT || 3000;
const CO_API_KEY = process.env.CO_API_KEY;
const WEBHOOK_SECRET = process.env.CENTRALONE_WEBHOOK_SECRET || process.env.CO_WEBHOOK_SECRET;
const BASE_URL = 'https://portal.centraloneglobal.com/api/v1';

async function callCentralOne(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Authorization': `Bearer ${CO_API_KEY}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  try {
    const response = await fetch(url, { ...options, headers });
    const textData = await response.text();
    let data;
    try { data = JSON.parse(textData); } catch (e) { data = { raw: textData }; }
    if (!response.ok) return { success: false, status: response.status, error: data };
    return data;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function fulfillOrderWithCentralOne(order) {
  try {
    const catalogRes = await callCentralOne('/catalog');
    let catalogUuid = null;
    if (catalogRes) {
      const itemsList = Array.isArray(catalogRes) ? catalogRes : (catalogRes.items || catalogRes.data || []);
      if (Array.isArray(itemsList) && itemsList.length > 0) {
        const rawPackageName = (order.package_name || '').split('->')[0].trim().toLowerCase();
        
        let matched = itemsList.find(item => {
          const sku = (item.sku || '').toString().toLowerCase();
          const name = (item.name || '').toString().toLowerCase();
          return (
            name.includes(rawPackageName) ||
            rawPackageName.includes(name) ||
            (sku && rawPackageName.includes(sku))
          );
        });

        if (!matched && rawPackageName.includes('evo')) {
          matched = itemsList.find(item => {
            const name = (item.name || '').toString().toLowerCase();
            return name.includes(rawPackageName);
          });
        }

        if (!matched) {
          matched = itemsList[0];
        }

        catalogUuid = matched.product_id || matched.id;
      }
    }
    if (!catalogUuid) {
      order.status = 'error_provider';
      order.provider_error = 'No se encontró product_id en el catálogo';
      return { success: false, error: order.provider_error };
    }

    const coOrderPayload = {
      game: order.game,
      player_id: (order.player_id || '').toString().trim(),
      items: [{ catalog_item_id: catalogUuid, quantity: 1, target_payload: { player_id: order.player_id, server: order.server } }]
    };

    const apiResponse = await callCentralOne('/orders', {
      method: 'POST',
      headers: { 'Idempotency-Key': `sokov-${order.id}-${Date.now()}` },
      body: JSON.stringify(coOrderPayload)
    });

    if (apiResponse.success === false || (apiResponse.error && apiResponse.status >= 400)) {
      order.status = 'error_provider';
      order.provider_error = apiResponse.error || apiResponse;
      return { success: false, error: 'Error en Central One', details: order.provider_error };
    }

    order.status = 'approved';
    order.provider_response = apiResponse;
    return { success: true, order, apiResponse };
  } catch (err) {
    order.status = 'error_provider';
    order.provider_error = err.message;
    return { success: false, error: err.message };
  }
}

app.post('/api/bank/auto-approve', async (req, res) => {
  const rawText = JSON.stringify(req.body);
  const match = rawText.match(/\b\d{4,12}\b/);
  if (!match) return res.status(400).json({ success: false, message: 'Referencia no encontrada' });

  const refNumber = match[0];
  bankReferences.add(refNumber);

  const order = localOrders.find(o => {
    const orderDigits = (o.reference || '').replace(/\D/g, '');
    return o.status === 'pending' && orderDigits && (orderDigits.endsWith(refNumber) || refNumber.endsWith(orderDigits));
  });

  if (order) {
    const result = await fulfillOrderWithCentralOne(order);
    return res.json({ success: true, reference: refNumber, matchedOrder: order.id, autoFulfilled: result.success });
  }

  return res.json({ success: true, reference: refNumber, matchedOrder: null });
});

app.post('/api/orders/submit', upload.single('receipt'), async (req, res) => {
  const { game, package_name, player_id, server, zone, phone, payment_method, reference } = req.body;
  const cleanRef = (reference || '').toString().trim().toLowerCase();
  const refDigits = (reference || '').toString().replace(/\D/g, '');

  if (!cleanRef) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ success: false, error: 'Referencia inválida' });
  }

  let receiptHash = null;
  if (req.file && fs.existsSync(req.file.path)) {
    receiptHash = crypto.createHash('sha256').update(fs.readFileSync(req.file.path)).digest('hex');
  }

  const duplicate = localOrders.find(o => ((o.reference || '').toLowerCase() === cleanRef || (receiptHash && o.receipt_hash === receiptHash)) && (o.status === 'pending' || o.status === 'approved'));
  if (duplicate) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ success: false, error: '⚠️ Este comprobante o referencia ya fue registrado.' });
  }

  const newOrder = {
    id: 'ORD-' + Date.now(),
    game,
    package_name,
    player_id,
    server: server || zone || 'LATAM',
    phone,
    payment_method,
    reference: reference.trim(),
    receipt: req.file ? `/uploads/${req.file.filename}` : null,
    receipt_hash: receiptHash,
    status: 'pending',
    created_at: new Date().toISOString()
  };

  localOrders.unshift(newOrder);

  const alreadyConfirmed = refDigits && Array.from(bankReferences).some(b => b.endsWith(refDigits) || refDigits.endsWith(b));
  if (alreadyConfirmed) {
    await fulfillOrderWithCentralOne(newOrder);
    return res.json({ success: true, autoApproved: true, order: newOrder });
  }

  res.json({ success: true, order: newOrder });
});

app.get('/api/admin/orders', (req, res) => res.json({ success: true, orders: localOrders }));

app.post('/api/admin/orders/:id/action', async (req, res) => {
  const order = localOrders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ success: false, error: 'No encontrado' });

  if (req.body.action === 'approve') {
    const result = await fulfillOrderWithCentralOne(order);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } else {
    order.status = 'rejected';
    return res.json({ success: true, order });
  }
});

app.post('/api/player/validate', async (req, res) => {
  let { game, player_id } = req.body;
  if (game?.toLowerCase().includes('free')) game = 'free-fire';
  if (game?.toLowerCase().includes('blood')) game = 'blood-strike';
  if (game?.toLowerCase().includes('mobile')) game = 'mobile-legends';

  const apiRes = await callCentralOne('/player/validate', {
    method: 'POST',
    body: JSON.stringify({ game, player_id, server: req.body.zone || req.body.server })
  });

  const obj = apiRes?.data || apiRes || {};
  const name = obj.nickname || obj.name || `Jugador #${player_id}`;
  res.json({ success: true, nickname: name, name, region: obj.region || 'LATAM' });
});

app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
