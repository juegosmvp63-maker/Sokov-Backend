import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

dotenv.config();  if (action === 'approve') {
    // Limpiamos el nombre del paquete para extraer solo los diamantes u oro o enviamos un SKU genérico válido
    // Central One espera un formato limpio de producto o ID de recarga directa
    const coOrderPayload = {
      product_sku: order.package_name.split(' ')[0], // Toma la cantidad limpia (ej: "110")
      player_id: order.player_id,
      game: order.game
    };

    const idempotencyKey = `sokov-${order.id}-${Date.now()}`;
    const apiResponse = await callCentralOne('/orders', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(coOrderPayload)
    });
  

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
    const data = await response.json();
    if (!response.ok) return { success: false, status: response.status, error: data };
    return data;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Registrar pedido desde la tienda web
app.post('/api/orders/submit', upload.single('receipt'), (req, res) => {
  const { game, package_name, player_id, phone, payment_method, reference } = req.body;
  const receiptUrl = req.file ? `/uploads/${req.file.filename}` : null;

  const newOrder = {
    id: 'ORD-' + Date.now(),
    game,
    package_name,
    player_id,
    phone,
    payment_method,
    reference: reference || 'N/A',
    receipt: receiptUrl,
    status: 'pending',
    created_at: new Date().toISOString()
  };

  localOrders.unshift(newOrder);
  res.json({ success: true, message: 'Pedido registrado con éxito en SokovmcDigital', order: newOrder });
});

// Listar pedidos para el panel admin
app.get('/api/admin/orders', (req, res) => {
  res.json({ success: true, orders: localOrders });
});

// ==========================================
// APROBAR PEDIDO Y DISPARAR API DE CENTRAL ONE
// ==========================================
app.post('/api/admin/orders/:id/action', async (req, res) => {
  const { id } = req.params;
  const { action } = req.body;

  const order = localOrders.find(o => o.id === id);
  if (!order) return res.status(404).json({ success: false, error: 'Pedido no encontrado' });

  if (action === 'approve') {
    // Mapeo inteligente o envío de orden a Central One Global
    // Nota: Asegúrate de que el paquete tenga el product_id / sku correcto de Central One o lo mandamos genérico
    const coOrderPayload = {
      product_sku: order.package_name, // O el identificador que use Central One
      player_id: order.player_id,
      game: order.game
    };

    const idempotencyKey = `sokov-${order.id}-${Date.now()}`;
    const apiResponse = await callCentralOne('/orders', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(coOrderPayload)
    });

    if (apiResponse.success === false) {
      // Si la API del proveedor falla, guardamos el error en la orden para que lo veas
      order.status = 'error_provider';
      order.provider_error = apiResponse.error;
      return res.status(400).json({ 
        success: false, 
        error: 'Error al procesar en Central One', 
        details: apiResponse.error 
      });
    }

    order.status = 'approved';
    order.provider_response = apiResponse;
    return res.json({ success: true, order, apiResponse });
  } else {
    order.status = 'rejected';
    return res.json({ success: true, order });
  }
});

// Rutas de la API de Central One
app.get('/api/balance', async (req, res) => res.json(await callCentralOne('/balance')));
app.get('/api/catalog', async (req, res) => res.json(await callCentralOne('/catalog')));
app.post('/api/player/validate', async (req, res) => {
  res.json(await callCentralOne('/player/validate', {
    method: 'POST',
    body: JSON.stringify(req.body)
  }));
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

  if (!crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature))) {
    return res.status(401).json({ error: 'Firma inválida' });
  }

  const eventPayload = JSON.parse(rawBody.toString('utf8'));
  console.log(`Webhook verificado [${eventPayload.event}] (ID: ${eventPayload.event_id})`);
  res.status(200).json({ received: true });
});

app.listen(PORT, () => {
  console.gt = console.log;
  console.log(`SokovmcDigital Backend corriendo en http://localhost:${PORT}`);
});
