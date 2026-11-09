const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CENTRAL_ONE_API_KEY = process.env.CENTRAL_ONE_API_KEY;

// Ruta raíz para verificar estado
app.get('/', (req, res) => {
    res.json({ status: 'online', store: 'Sokov MC Digital' });
});

// Ruta exactamente igual a la que llama el frontend (index.html)
app.post('/api/crear-pedido', async (req, res) => {
    try {
        const { catalog_item_id, player_id } = req.body;

        if (!catalog_item_id || !player_id) {
            return res.status(400).json({
                success: false,
                message: 'Faltan parámetros: catalog_item_id o player_id.'
            });
        }

        if (!CENTRAL_ONE_API_KEY) {
            console.error('[ERROR] Falta CENTRAL_ONE_API_KEY en Render.');
            return res.status(500).json({
                success: false,
                message: 'Error de configuración en el servidor backend.'
            });
        }

        console.log(`[PEDIDO] Producto: ${catalog_item_id} | Jugador ID: ${player_id}`);

        const payload = {
            product_id: catalog_item_id,
            player_id: player_id
        };

        const response = await fetch('https://api.centraloneglobal.com/v1/orders', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CENTRAL_ONE_API_KEY}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const rawText = await response.text();
        let data;
        try {
            data = JSON.parse(rawText);
        } catch (e) {
            console.error('[ERROR] Respuesta no JSON de Central One:', rawText);
            return res.status(502).json({
                success: false,
                message: 'El proveedor externo devolvió una respuesta no válida.',
                raw: rawText
            });
        }

        if (!response.ok) {
            console.error('=== ERROR CENTRAL ONE ===', JSON.stringify(data, null, 2));
            return res.status(response.status).json({
                success: false,
                message: data.message || 'Central One rechazó el pedido.',
                detail: data
            });
        }

        console.log('[ÉXITO] Pedido creado:', data);
        res.json({
            success: true,
            order: data.order || data
        });

    } catch (error) {
        console.error('[EXCEPCIÓN]:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno en el servidor.',
            error: error.message
        });
    }
});

// Compatibilidad por si acaso con /api/recharge
app.post('/api/recharge', async (req, res) => {
    req.body.catalog_item_id = req.body.catalog_item_id || req.body.optionId;
    req.body.player_id = req.body.player_id || req.body.playerId;
    // Redirigir internamente o ejecutar misma lógica
    // (Podemos delegar o dejarlo directo)
    res.redirect(307, '/api/crear-pedido');
});

app.listen(PORT, () => {
    console.log(`Servidor Sokov MC Digital activo en puerto ${PORT}`);
});
