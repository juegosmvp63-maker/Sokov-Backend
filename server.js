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

// ==========================================
// STORE & ADMIN ENDPOINTS (SokovmcDigital)
// ==========================================

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

// APROBAR O RECHAZAR PEDIDO
app.post('/api/admin/orders/:id/action', async (req, res) => {
  const { id } = req.params;
  const { action } = req.body;

  const order = localOrders.find(o => o.id === id);
  if (!order) return res.status(404).json({ success: false, error: 'Pedido no encontrado' });

  if (action === 'approve') {
    try {
      // 1. Consultar el catálogo oficial para obtener el UUID exacto (catalog_item_id)
      const catalogRes = await callCentralOne('/catalog');
      
      let catalogUuid = null;
      if (catalogRes) {
        // Manejar posibles estructuras de respuesta del catálogo de Central One
        const itemsList = Array.isArray(catalogRes) ? catalogRes : (catalogRes.data || catalogRes.items || catalogRes.catalog || []);
        if (Array.isArray(itemsList)) {
          const searchKey = (order.package_name || '').trim().toLowerCase();
          
          // Buscar coincidencia exacta o por inclusión del nombre/SKU/ID
          const matchedItem = itemsList.find(item => {
            const itemId = (item.id || item.catalog_item_id || '').toString().toLowerCase();
            const itemName = (item.name || item.title || item.product_name || '').toString().toLowerCase();
            const itemSku = (item.sku || item.product_sku || '').toString().toLowerCase();
            
            return itemId.includes(searchKey) || searchKey.includes(itemId) || 
                   itemName.includes(searchKey) || searchKey.includes(itemName) ||
                   itemSku.includes(searchKey);
          });

          if (matchedItem) {
            catalogUuid = matchedItem.id || matchedItem.catalog_item_id;
          } else if (itemsList.length > 0) {
            // Fallback inteligente: si hay elementos, tomar el primero o buscar por número extraído
            const numbersOnly = searchKey.replace(/[^0-9]/g, '');
            const fallbackItem = itemsList.find(item => {
              const name = (item.name || item.title || '').toString();
              return numbersOnly && name.includes(numbersOnly);
            });
            if (fallbackItem) {
              catalogUuid = fallbackItem.id || fallbackItem.catalog_item_id;
            } else {
              catalogUuid = itemsList[0].id || itemsList[0].catalog_item_id;
            }
          }
        }
      }

      // Si aun así no se obtiene UUID, usar el string limpio como fallback extremo
      const finalCatalogItemId = catalogUuid || order.package_name.trim().split(' ')[0];

      // 2. Construir la estructura exacta exigida por Central One Global API
      const coOrderPayload = {
        game: order.game,
        player_id: order.player_id,
        items: [
          {
            catalog_item_id: finalCatalogItemId,
            quantity: 1
          }
        ]
      };

      console.log("Enviando orden a Central One con payload:", JSON.stringify(coOrderPayload));

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
        return res.status(400).json({ 
          success: false, 
          error: 'Error al procesar en Central One', 
          details: apiResponse.error || apiResponse 
        });
      }

      order.status = 'approved';
      order.provider_response = apiResponse;
      return res.json({ success: true, order, apiResponse });

    } catch (err) {
      console.error("Excepción crítica al aprobar orden:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  } else {
    order.status = 'rejected';
    return res.json({ success: true, order });
  }
});

// ==========================================
// CENTRAL ONE API PROXY ENDPOINTS (COMPLETOS)
// ==========================================

// Balance
app.get('/api/balance', async (req, res) => {
  res.json(await callCentralOne('/balance'));
});

// Catalog
app.get('/api/catalog', async (req, res) => {
  res.json(await callCentralOne('/catalog'));
});

// Player Validation
app.post('/api/player/validate', async (req, res) => {
  res.json(await callCentralOne('/player/validate', {
    method: 'POST',
    body: JSON.stringify(req.body)
  }));
});

app.get('/api/player/validate/coverage', async (req, res) => {
  res.json(await callCentralOne('/player/validate/coverage'));
});

// Orders Management
app.post('/api/orders', async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'] || `order-${Date.now()}`;
  res.json(await callCentralOne('/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(req.body)
  }));
});

app.get('/api/orders', async (req, res) => {
  res.json(await callCentralOne('/orders'));
});

app.get('/api/orders/:id', async (req, res) => {
  res.json(await callCentralOne(`/orders/${req.params.id}`));
});

app.get('/api/orders/:id/codes', async (req, res) => {
  res.json(await callCentralOne(`/orders/${req.params.id}/codes`));
});

// Webhooks Management
app.get('/api/webhooks', async (req, res) => {
  res.json(await callCentralOne('/webhooks'));
});

app.get('/api/webhooks/deliveries', async (req, res) => {
  res.json(await callCentralOne('/webhooks/deliveries'));
});

app.post('/api/webhooks/test', async (req, res) => {
  res.json(await callCentralOne('/webhooks/test', {
    method: 'POST',
    body: JSON.stringify(req.body || {})
  }));
});

app.post('/api/webhooks/deliveries/:id/replay', async (req, res) => {
  res.json(await callCentralOne(`/webhooks/deliveries/${req.params.id}/replay`, {
    method: 'POST'
  }));
});

// Webhook Receiver (Incoming from Central One)
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
    return res.status(401).json({ error: 'Firma inválida o malformada' });
  }

  const eventPayload = JSON.parse(rawBody.toString('utf8'));
  console.log(`Webhook verificado [${eventPayload.event}] (ID: ${eventPayload.event_id})`);
  res.status(200).json({ received: true });
});

app.listen(PORT, () => {
  console.log(`SokovmcDigital Backend corriendo en http://localhost:${PORT}`);
});
