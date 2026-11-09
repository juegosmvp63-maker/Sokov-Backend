const express = require('express');
const axios = require('axios');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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

const CO_API_KEY = process.env.CO_API_KEY;
const CO_BASE_URL = "https://portal.centraloneglobal.com/api/v1";

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
    res.json({ success: true, message: "Comprobante recibido", order: newOrder });
});

app.get('/api/v1/admin/orders', (req, res) => {
    res.json({ success: true, orders: pendingOrders });
});

// APROBAR ORDEN CONECTADO DIRECTAMENTE A CENTRALONE - SIN NINGÚN MODO DE RESPALDO
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

    console.log(`[CentralOne] Procesando orden ${order.id} para jugador ${order.player_id} con SKU ${sku}...`);

    try {
        const response = await axios.post(`${CO_BASE_URL}/orders`, {
            items: [
                {
                    product_sku: sku,
                    quantity: 1,
                    target_payload: { player_id: order.player_id }
                }
            ],
            note: `Sokov MC Digital - Ref: ${order.payment_ref}`
        }, {
            headers: {
                'Authorization': `Bearer ${CO_API_KEY}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': `sokov-${order.id}`
            },
            timeout: 20000
        });

        order.status = "approved";
        console.log("[CentralOne] ¡Recarga exitosa!", response.data);
        return res.json({ 
            success: true, 
            message: "¡Recarga procesada y enviada al juego por CentralOne!", 
            centralone_response: response.data 
        });

    } catch (error) {
        console.error("[CentralOne Error]:", error.response ? error.response.data : error.message);
        const errorMsg = error.response && error.response.data && error.response.data.message 
            ? error.response.data.message 
            : error.message;
            
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
    res.json({ success: true, status: "valid", player_id: player_id, nickname: `Jugador_${player_id.substring(0, 4)}` });
});

app.listen(PORT, () => {
    console.log(`Servidor Sokov MC Digital corriendo en puerto ${PORT}`);
});
