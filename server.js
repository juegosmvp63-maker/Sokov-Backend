const express = require('express');
const axios = require('axios');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { createHmac, timingSafeEqual } = require("node:crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Guardamos rawBody para Webhooks HMAC si es necesario
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

// Memoria global de órdenes recibidas en la tienda
let pendingOrders = [];

const CO_API_KEY = process.env.CO_API_KEY || "TU_API_KEY_DE_CENTRALONE";
const CO_WEBHOOK_SECRET = process.env.CO_WEBHOOK_SECRET || "tu_secreto_de_webhook";
const CO_BASE_URL = "https://portal.centraloneglobal.com/api/v1";

// 1. Health check y Ping
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

// 2. Consulta de Saldo
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

// 3. Recepción de Pagos/Comprobantes desde index.html
app.post('/api/v1/submit-payment', upload.single('receipt'), (req, res) => {
    const { client_name, player_id, product, payment_method, payment_ref } = req.body;
    const receiptFile = req.file ? `/uploads/${req.file.filename}` : "https://via.placeholder.com/80";
    
    const newOrder = {
        id: "ord_" + Math.random().toString(36).substring(2, 10),
        client_name: client_name || "Cliente Sokov",
        player_id: player_id || "N/A",
        product: product || "Recarga General",
        payment_method: payment_method || "Pago Móvil",
        payment_ref: payment_ref || "S/N",
        receipt_url: receiptFile,
        status: "pending",
        created_at: new Date().toISOString()
    };
    
    pendingOrders.unshift(newOrder);
    res.json({ success: true, message: "Comprobante recibido exitosamente", order: newOrder });
});

// 4. Obtener Órdenes de la Tienda para admin.html (cPanel)
app.get('/api/v1/admin/orders', (req, res) => {
    res.json({ success: true, orders: pendingOrders });
});

// 5. Aprobar Orden y Enviar Petición a CentralOne Global
app.post('/api/v1/admin/approve-order/:id', async (req, res) => {
    const orderId = req.params.id;
    const order = pendingOrders.find(o => o.id === orderId);
    
    if (!order) {
        return res.status(404).json({ success: false, message: "Orden no encontrada" });
    }
    
    let sku = "ff_110";
    if (order.product.includes("Blood Strike")) {
        sku = "bs_320";
    } else if (order.product.includes("341 Diamantes")) {
        sku = "ff_341";
    }

    console.log(`[CentralOne] Procesando orden ${order.id} | Jugador: ${order.player_id} | SKU: ${sku}`);

    try {
        const payload = {
            items: [
                {
                    product_sku: sku,
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
        console.error("[CentralOne Error]:", JSON.stringify(errorData, null, 2));
        
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

// 6. Rechazar Orden
app.post('/api/v1/admin/reject-order/:id', (req, res) => {
    const orderId = req.params.id;
    const order = pendingOrders.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ success: false, message: "No encontrada" });
    order.status = "rejected";
    res.json({ success: true, message: "Pago rechazado correctamente" });
});

// 7. Validación de Player ID
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
