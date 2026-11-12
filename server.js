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
    console.log(`[Central One Request] ${options.method || 'GET'} ${url}`);
    if (options.body) console.log(`[Central One Body]`, options.body);

    const response = await fetch(url, { ...options, headers });
    const textData = await response.text();
    let data;
    try {
      data = JSON.parse(textData);
    } catch (e) {
      data = { raw: textData };
    }

    if (!response.ok) {
      console.error(`[Central One Error] ${response.status} on ${endpoint}:`, JSON.stringify(data));
      return { success: false, status: response.status, error: data };
    }
    return data;
  } catch (error) {
    console.error(`[Fetch Exception] on ${endpoint}:`, error.message);
    return { success: false, error: error.message };
  }
}

// Función reutilizable para procesar la entrega automática en Central One Global
async function fulfillOrderWithCentralOne(order) {
  try {
    const catalogRes = await callCentralOne('/catalog');
    let catalogUuid = null;
    let matchedProduct = null;

    if (catalogRes) {
      const itemsList = Array.isArray(catalogRes) ? catalogRes : (catalogRes.items || catalogRes.data || []);
      if (Array.isArray(itemsList) && itemsList.length > 0) {
        const searchKey = (order.package_name || '').trim().toLowerCase();
        matchedProduct = itemsList.find(item => {
          const prodId = (item.product_id || item.id || '').toString().toLowerCase();
          const sku = (item.sku || '').toString().toLowerCase();
          const name = (item.name || '').toString().toLowerCase();
          return searchKey.includes(sku) || sku.includes(searchKey) ||
                 searchKey.includes(name) || name.includes(searchKey) ||
                 prodId === searchKey;
        });

        if (!matchedProduct) {
          const numbersOnly = searchKey.replace(/[^0-9]/g, '');
          matchedProduct = itemsList.find(item => {
            const name = (item.name || '').toString();
            const sku = (item.sku || '').toString();
            return numbersOnly && (name.includes(numbersOnly) || sku.includes(numbersOnly));
          }) || itemsList[0];
        }

        if (matchedProduct) {
          catalogUuid = matchedProduct.product_id || matchedProduct.id;
        }
      }
    }

    if (!catalogUuid) {
      order.status = 'error_provider';
      order.provider_error = 'No se encontró product_id en el catálogo de Central One';
      return { success: false, error: order.provider_error };
    }

    const targetPayload = {
      player_id: (order.player_id || '').toString().trim(),
      server: (order.server || 'LATAM').toString().trim()
    };

    const coOrderPayload = {
      game: order.game,
      player_id: targetPayload.player_id,
      items: [
        {
          catalog_item_id: catalogUuid,
          quantity: 1,
          target_payload: targetPayload
        }
      ]
    };

    console.log("Enviando orden automática a Central One:", JSON.stringify(coOrderPayload));

    const idempotencyKey = `sokov-${order.id}-${Date.now()}`;
    const apiResponse = await callCentralOne('/orders', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(coOrderPayload)
    });

    console.log("Respuesta de Central One:", JSON.stringify(apiResponse));

    if (apiResponse.success === false || (apiResponse.error && apiResponse.status >= 400)) {
      order.status = 'error_provider';
      order.provider_error = apiResponse.error || apiResponse;
      return { success: false, error: 'Error al procesar en Central One', details: order.provider_error };
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

// ==========================================
// BANK AUTO-APPROVE WEBHOOK (Android App)
// ==========================================
app.post('/api/bank/auto-approve', async (req, res) => {
  console.log('Webhook de Banco recibido desde Android:', req.body);
  const rawText = JSON.stringify(req.body);
  const match = rawText.match(/\b\d{4,12}\b/);

  if (!match) {
    return res.status(400).json({
      success: false,
      message: 'No se pudo extraer la referencia del mensaje.',
      received: req.body.reference || rawText
    });
  }

  const refNumber = match[0];
  bankReferences.add(refNumber);

  // Buscar orden pendiente que coincida con los últimos dígitos o referencia completa
  const order = localOrders.find(o => {
    const orderDigits = (o.reference || '').replace(/\D/g, '');
    return o.status === 'pending' && orderDigits && (orderDigits.endsWith(refNumber) || refNumber.endsWith(orderDigits));
  });

  if (order) {
    console.log(`⚡ Coincidencia bancaria [${refNumber}] con orden ${order.id}. Ejecutando entrega automática...`);
    const result = await fulfillOrderWithCentralOne(order);
    return res.json({
      success: true,
      reference: refNumber,
      matchedOrder: order.id,
      autoFulfilled: result.success,
      details: result
    });
  }

  return res.json({ success: true, reference: refNumber, matchedOrder: null, message: 'Referencia guardada en espera de pedido.' });
});

// ==========================================
// STORE & ADMIN ENDPOINTS (SokovmcDigital)
// ==========================================
app.post('/api/orders/submit', upload.single('receipt'), async (req, res) => {
  const { game, package_name, player_id, server, zone, phone, payment_method, reference } = req.body;
  const cleanRef = (reference || '').toString().trim().toLowerCase();
  const refDigits = (reference || '').toString().replace(/\D/g, '');

  if (!cleanRef || cleanRef === 'n/a') {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ success: false, error: 'Debes ingresar un número de referencia válido.' });
  }

  let receiptHash = null;
  if (req.file && fs.existsSync(req.file.path)) {
    const fileBuffer = fs.readFileSync(req.file.path);
    receiptHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }

  const duplicateOrder = localOrders.find(o => {
    const isSameRef = (o.reference || '').toString().trim().toLowerCase() === cleanRef;
    const isSameImage = receiptHash && o.receipt_hash === receiptHash;
    return (isSameRef || isSameImage) && (o.status === 'pending' || o.status === 'approved');
  });

  if (duplicateOrder) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(400).json({
      success: false,
      error: '⚠️ Este comprobante o número de referencia ya fue registrado anteriormente. No se permite reutilizar el mismo comprobante.'
    });
  }

  const receiptUrl = req.file ? `/uploads/${req.file.filename}` : null;

  const newOrder = {
    id: 'ORD-' + Date.now(),
    game,
    package_name,
    player_id,
    server: server || zone || 'LATAM',
    phone,
    payment_method,
    reference: reference.trim(),
    receipt: receiptUrl,
    receipt_hash: receiptHash,
    status: 'pending',
    created_at: new Date().toISOString()
  };

  localOrders.unshift(newOrder);

  // Verificar si el banco ya había enviado este pago segundos antes de que el cliente enviara el formulario
  const alreadyConfirmedByBank = refDigits && Array.from(bankReferences).some(bRef => bRef.endsWith(refDigits) || refDigits.endsWith(bRef));

  if (alreadyConfirmedByBank) {
    console.log(`⚡ Pago ya estaba confirmado por el banco (${refDigits}). Procesando entrega inmediata para ${newOrder.id}...`);
    await fulfillOrderWithCentralOne(newOrder);
    return res.json({
      success: true,
      autoApproved: true,
      message: '¡Pago verificado automáticamente y recarga enviada al instante!',
      order: newOrder
    });
  }

  res.json({ success: true, message: 'Pedido registrado con éxito en SokovmcDigital', order: newOrder });
});

app.get('/api/admin/orders', (req, res) => {
  res.json({ success: true, orders: localOrders });
});

app.post('/api/admin/orders/:id/action', async (req, res) => {
  const { id } = req.params;
  const { action } = req.body;

  const order = localOrders.find(o => o.id === id);
  if (!order) return res.status(404).json({ success: false, error: 'Pedido no encontrado' });

  if (order.status === 'approved') {
    return res.status(400).json({ success: false, error: 'Este pedido ya fue aprobado anteriormente. No se puede volver a procesar.' });
  }
  if (order.status === 'rejected') {
    return res.status(400).json({ success: false, error: 'Este pedido ya fue rechazado.' });
  }

  if (action === 'approve') {
    const result = await fulfillOrderWithCentralOne(order);
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } else {
    order.status = 'rejected';
    return res.json({ success: true, order });
  }
});

// PROXY DE ENDPOINTS DE CENTRAL ONE CON EXTRACCIÓN ROBUSTA DE NICKNAME
app.get('/api/balance', async (req, res) => res.json(await callCentralOne('/balance')));
app.get('/api/catalog', async (req, res) => res.json(await callCentralOne('/catalog')));

app.post('/api/player/validate', async (req, res) => {
  let { game, player_id } = req.body;
  
  if (game && game.toLowerCase().includes('free')) game = 'free-fire';
  if (game && game.toLowerCase().includes('blood')) game = 'blood-strike';
  if (game && game.toLowerCase().includes('mobile')) game = 'mobile-legends';

  const valPayload = { game, player_id };
  if (req.body.zone || req.body.server) {
    valPayload.server = req.body.zone || req.body.server;
    valPayload.zone_id = req.body.zone || req.body.server;
  }
  const apiRes = await callCentralOne('/player/validate', {
    method: 'POST',
    body: JSON.stringify(valPayload)
  });

  console.log("Respuesta cruda de Central One /player/validate:", JSON.stringify(apiRes));

  let foundName = null;
  let foundRegion = 'LATAM';

  if (apiRes) {
    const obj = apiRes.data || apiRes;
    foundName = obj.nickname || obj.name || obj.player_name || obj.username || obj.account_name || obj.customer_name;
    foundRegion = obj.region || obj.server || obj.zone || 'LATAM';
  }

  if (!foundName) {
    foundName = `Jugador #${player_id}`;
  }

  return res.json({
    success: true,
    nickname: foundName,
    name: foundName,
    region: foundRegion,
    data: {
      nickname: foundName,
      name: foundName,
      region: foundRegion
    }
  });
});

app.get('/api/player/validate/coverage', async (req, res) => res.json(await callCentralOne('/player/validate/coverage')));
app.post('/api/orders', async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'] || `order-${Date.now()}`;
  res.json(await callCentralOne('/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(req.body)
  }));
});
app.get('/api/orders', async (req, res) => res.json(await callCentralOne('/orders')));
app.get('/api/orders/:id', async (req, res) => res.json(await callCentralOne(`/orders/${req.params.id}`)));
app.get('/api/orders/:id/codes', async (req, res) => res.json(await callCentralOne(`/orders/${req.params.id}/codes`)));
app.get('/api/webhooks', async (req, res) => res.json(await callCentralOne('/webhooks')));
app.get('/api/webhooks/deliveries', async (req, res) => res.json(await callCentralOne('/webhooks/deliveries')));
app.post('/api/webhooks/test', async (req, res) => {
  res.json(await callCentralOne('/webhooks/test', { method: 'POST', body: JSON.stringify(req.body || {}) }));
});
app.post('/api/webhooks/deliveries/:id/replay', async (req, res) => {
  res.json(await callCentralOne(`/webhooks/deliveries/${req.params.id}/replay`, { method: 'POST' }));
});

app.post('/api/webhooks/receive', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-centralone-signature'];
  const timestamp = req.headers['x-centralone-timestamp'];
  const rawBody = req.body;

  if (!WEBHOOK_SECRET) return res.status(500).json({ error: 'Falta configurar Webhook Secret' });
  if (!signature || !timestamp) return res.status(400).json({ error: 'Faltan cabeceras de firma' });

  const payloadToSign = `${timestamp}.${rawBody.toString('utf8')}`;
  const expectedSignature = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(payloadToSign).digest('hex');

  try {
    if (!crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature))) {
      return res.status(401).json({ error: 'Firma inválida' });
    }
  } catch (e) {
    return res.status(401).json({ error: 'Firma inválida' });
  }

  const eventPayload = JSON.parse(rawBody.toString('utf8'));
  console.log(`Webhook verificado [${eventPayload.event}] (ID: ${eventPayload.event_id})`);
  res.status(200).json({ received: true });
});

app.listen(PORT, () => {
  console.log(`SokovmcDigital Backend & Store 100% Auto corriendo en puerto ${PORT}`);
});
