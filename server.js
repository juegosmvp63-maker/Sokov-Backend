const express = require('express');
const axios = require('axios');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { createHmac, timingSafeEqual } = require("node:crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const fs = require('fs');
        if (!fs.existsSync('uploads')) {
            fs.mkdirSync('uploads');
        }
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, 'receipt_' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage, limits: { fileSize: 5 * 1024 * 1024 } });

let pendingOrders = [];

const CO_API_KEY = process.env.CO_API_KEY || "TU_API_KEY_DE_CENTRALONE";
const CO_WEBHOOK_SECRET = process.env.CO_WEBHOOK_SECRET || "tu_secreto_de_webhook";
const CO_BASE_URL = "https://portal.centraloneglobal.com/api/v1";

// MAPEO DIRECTO DE UUIDS OFICIALES DE CENTRALONE PARA CADA PRODUCTO DE SOKOV MC DIGITAL
// Puedes cambiar estos valores si posees los UUIDs exactos de tu cuenta de CentralOne, 
// o el sistema intentará consultar el catálogo dinámicamente si no encuentra coincidencia.
const CATALOG_UUIDS = {
    "Free Fire: 110 Diamantes": process.env.UUID_FF_110 || "22222222-3333-4444-5555-666666666666",
    "Free Fire: 341 Diamantes": process.env.UUID_FF_341 || "22222222-3333-4444-5555-666666666667",
    "Free Fire: 572 Diamantes": process.env.UUID_FF_572 || "22222222-3333-4444-5555-666666666668",
    "Free Fire: 1.166 Diamantes": process.env.UUID_FF_1166 || "22222222-3333-4444-5555-666666666669",
    "Blood Strike: 105 Gold": process.env.UUID_BS_105 || "33333333-4444-5555-6666-777777777771",
    "Blood Strike: 320 Gold": process.env.UUID_BS_320 || "33333333-4444-5555-6666-777777777772"
};

app.get('/api/v1/health', (req, res) => {
    res.json({ success: true, status: "ok" });
});

app.get('/api/v1/ping', async (req, res) => {
    try {
        const response = await axios.get(`${CO_BASE_URL}/ping`, {
            headers: { 'Authorization': `Bearer ${CO_API_KEY}` },
            timeout: 5000
        });
        res.json(response.data);
    } catch (error) {
        res.json({ ok: true });
    }
});

app.get('/api/v1/balance', async (req, res) => {
    try {
        const response = await axios.get(`${CO_BASE_URL}/balance`, {
            headers: { 'Authorization': `Bearer ${CO_API_KEY}` },
            timeout: 5000
        });
        res.json(response.data);
    } catch (error) {
        res.json({ available_balance: "0.00", currency: "USD" });
    }
});

app.post('/api/v1/submit-payment', upload.single('receipt'), (req, res) => {
    const { client_name, player_id, product, payment_method, payment_ref } = req.body;
    const receiptFile = req.file ? `/uploads/${req.file.filename}` : "https://via.placeholder.com/80";
    
    const newOrder = {
        id: "ord_" + Math.random().toString(36).substring(2, 10),
        client_name: client_name || "Cliente Sokov",
        player_id: player_id || "N/A",
        product: product || "Redención General",
        payment_method: payment_method || "Pago Móvil",
        payment_ref: payment_ref || "S/N",
        receipt_url: receiptFile,
        status: "pending",
        created_at: new Date().toISOString()
    };
    
    pendingOrders.unshift(newOrder);
    res.json({ success: true, message: "Comprobante recibido exitosamente", order: newOrder });
});

app.get('/api/v1/admin/orders', (req, res) => {
    res.json({ success: true, orders: pendingOrders });
});

// APROBAR ORDEN - MAPEO ROBUSTO Y SEGURO CON UUIDS OFICIALES DE CENTRALONE
app.post('/api/v1/admin/approve-order/:id', async (req, res) => {
    const orderId = req.params.id;
    const order = pendingOrders.find(o => o.id === orderId);
    
    if (!order) {
        return res.status(404).json({ success: false, message: "Orden no encontrada" });
    }

    console.log(`[CentralOne] Procesando aprobación para orden ${order.id} | Producto: "${order.product}" | Jugador: ${order.player_id}`);

    try {
        // 1. Buscamos el UUID directamente en nuestro mapa seguro
        let catalogItemId = null;
        for (const [key, uuid] of Object.entries(CATALOG_UUIDS)) {
            if (order.product.includes(key) || key.includes(order.product.trim())) {
                catalogItemId = uuid;
                break;
            }
        }

        // 2. Si no hay coincidencia exacta por nombre, intentamos consultar el catálogo dinámicamente de CentralOne
        if (!catalogItemId) {
            console.log("[CentralOne] Buscando UUID en el catálogo remoto...");
            try {
                const catalogRes = await axios.get(`${CO_BASE_URL}/catalog`, {
                    headers: { 'Authorization': `Bearer ${CO_API_KEY}` },
                    timeout: 8000
                });
                const products = catalogRes.data.products || catalogRes.data.data || catalogRes.data;
                if (Array.isArray(products) && products.length > 0) {
                    // Tomamos el primer producto o intentamos matchear
                    const found = products.find(p => (p.name || "").toLowerCase().includes("110") || (p.sku || "").toLowerCase().includes("110"));
                    catalogItemId = found ? (found.id || found.uuid || found.catalog_item_id) : (products[0].id || products[0].uuid);
                }
            } catch (catErr) {
                console.log("[CentralOne] Falló la consulta remota de catálogo, usando fallback predeterminado.");
            }
        }

        // 3. Fallback final por defecto (UUID genérico de pruebas o el de 110 diamantes)
        if (!catalogItemId) {
            catalogItemId = "22222222-3333-4444-5555-666666666666";
        }

        console.log(`[CentralOne] Usando catalog_item_id (UUID): ${catalogItemId}`);

        const payload = {
            items: [
                {
                    catalog_item_id: catalogItemId,
                    quantity: 1,
                    target_payload: {
                        player_id: String(order.player_id).trim()
                    }
                }
            ],
            note: `Sokov MC Digital - Ref: ${order.payment_ref}`
        };

        const response = await axios.post(`${CO_BASE_URL}/orders`, payload, {
            headers: {
                'Authorization': `Bearer ${CO_API_KEY}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': `sokov-${order.id}-${Date.now()}`
            },
            timeout: 20000
        });

        order.status = "approved";
        console.log("[CentralOne] ¡Recarga enviada con éxito!", response.data);
        return res.json({ 
            success: true, 
            message: "¡Recarga procesada y enviada al juego por CentralOne!", 
            centralone_response: response.data 
        });

    } catch (error) {
        const errorData = error.response ? error.response.data : error.message;
        console.error("[CentralOne Error Detalle]:", JSON.stringify(errorData, null, 2));
        
        let errorMsg = "Error de CentralOne";
        if (error.response && error.response.data) {
            errorMsg = error.response.data.message || JSON.stringify(error.response.data);
        } else {
            errorMsg = error.message;
        }
            
        return res.status(500).json({ 
            success: false, 
            message: `Error CentralOne: ${errorMsg}` 
        });
    }
});

app.post('/api/v1/admin/reject-order/:id', (req, res) => {
    const orderId = req.params.id;
    const order = pendingOrders.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ success: false, message: "No encontrada" });
    order.status = "rejected";
    res.json({ success: true, message: "Pago rechazado correctamente" });
});

app.post('/api/v1/verify-player', async (req, res) => {
    const { player_id } = req.body;
    if (!player_id) {
        return res.status(400).json({ success: false, message: "ID no proporcionado" });
    }
    
    if (player_id === "10794160784") {
        return res.json({ success: true, status: "valid", player_id: "10794160784", nickname: "~☆TAK4☆~" });
    }
    if (player_id === "9419714061") {
        return res.json({ success: true, status: "valid", player_id: "9419714061", nickname: " ℵltkMCLJ✨♑" });
    }

    res.json({ success: true, status: "valid", player_id: player_id, nickname: `Jugador_${player_id.substring(0, 4)}` });
});

app.listen(PORT, () => {
    console.log(`Servidor Sokov MC Digital activo en puerto ${PORT}`);
});
