// server.js - Backend para SokovmcDigital (Central One Global)
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// CONFIGURACIÓN DE CENTRAL ONE GLOBAL
const CENTRAL_API_URL = "https://portal.centraloneglobal.com"; 
const CENTRAL_API_KEY = "co_live_oslbOclPdmLyf5cBdtZi0_6W9lIEPnAW5OrpmzRwKh8"; // Tu llave de Central One Global

// Ruta para procesar la recarga automática desde tu web
app.post('/api/recargar', async (req, res) => {
    const { playerId, productSku, idempotencyKey } = req.body;

    if (!playerId || !productSku) {
        return res.status(400).json({ success: false, message: "Faltan datos del pedido (ID o Producto)." });
    }

    try {
        const response = await axios.post(`${CENTRAL_API_URL}/orders`, {
            player_id: playerId,
            sku: productSku
        }, {
            headers: {
                'Authorization': `Bearer ${CENTRAL_API_KEY}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey || `sokov-${Date.now()}`
            }
        });

        return res.json({ 
            success: true, 
            message: "¡Pedido enviado a Central One con éxito!", 
            data: response.data 
        });

    } catch (error) {
        console.error("Error al conectar con Central One:", error.response ? error.response.data : error.message);
        return res.status(500).json({ 
            success: false, 
            message: "Error procesando la orden con el proveedor.",
            details: error.response ? error.response.data : error.message
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor SokovMC Digital activo en el puerto ${PORT}`));
