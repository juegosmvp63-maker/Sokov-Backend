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

// APROBAR ORDEN - ESTRUCTURA DIRECTA AJUSTADA PARA CENTRALONE GLOBAL
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
        // Enviamos la petición con la estructura estándar de órdenes directas
        const payload = {
            sku: sku,
            account: String(order.player_id).trim(),
            player_id: String(order.player_id).trim(),
            quantity: 1,
            reference: `sokov-${order.id}`
        };

        const response = await axios.post(`${CO_BASE_URL}/orders`, payload, {
            headers: {
                'Authorization': `Bearer ${CO_API_KEY}`,
                'Content-Type': 'application/json'
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
