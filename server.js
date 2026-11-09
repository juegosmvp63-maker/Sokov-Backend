/**
 * ==============================================================================
 * SOKOV MC DIGITAL - SERVIDOR BACKEND OFICIAL (NODE.JS / EXPRESS)
 * Integración con Central One Global API (Estructura corregida según logs)
 * ==============================================================================
 */

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CENTRAL_ONE_API_KEY = process.env.CENTRAL_ONE_API_KEY;
const CENTRAL_ONE_BASE_URL = 'https://portal.centraloneglobal.com/api/v1';

// Ruta raíz para verificar estado
app.get('/', (req, res) => {
    res.json({ 
        status: 'online', 
        store: 'Sokov MC Digital', 
        message: 'Servidor backend operando correctamente y conectado a Central One' 
    });
});

// Endpoint de Health
app.get('/api/v1/health', async (req, res) => {
    try {
        const response = await fetch(`${CENTRAL_ONE_BASE_URL}/health`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint de Ping
app.get('/api/v1/ping', async (req, res) => {
    try {
        if (!CENTRAL_ONE_API_KEY) {
            return res.status(500).json({ success: false, message: 'Falta CENTRAL_ONE_API_KEY en Render.' });
        }
        const response = await fetch(`${CENTRAL_ONE_BASE_URL}/ping`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${CENTRAL_ONE_API_KEY}`,
                'Accept': 'application/json'
            }
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Ruta principal para procesar pedidos (ajustada a los requerimientos de los logs)
app.post('/api/crear-pedido', async (req, res) => {
    try {
        const { catalog_item_id, player_id } = req.body;

        if (!catalog_item_id || !player_id) {
            return res.status(400).json({
                success: false,
                message: 'Faltan parámetros obligatorios: catalog_item_id o player_id.'
            });
        }

        if (!CENTRAL_ONE_API_KEY) {
            console.error('[ERROR] La variable CENTRAL_ONE_API_KEY no está configurada.');
            return res.status(500).json({
                success: false,
                message: 'Error de configuración interna del servidor.'
            });
        }

        console.log(`[SOKOV MC] Procesando pedido -> Producto: ${catalog_item_id} | Jugador ID: ${player_id}`);

        // Estructura exigida por Central One según el reporte de logs:
        // 1. Cabecera Idempotency-Key obligatoria
        // 2. Arreglo "items" requerido en el payload
        const idempotencyKey = crypto.randomUUID();

        const payload = {
            items: [
                {
                    product_id: catalog_item_id,
                    player_id: player_id
                }
            ]
        };

        const response = await fetch(`${CENTRAL_ONE_BASE_URL}/orders`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CENTRAL_ONE_API_KEY}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Idempotency-Key': idempotencyKey
            },
            body: JSON.stringify(payload)
        });

        const rawText = await response.text();
        let responseData;

        try {
            responseData = JSON.parse(rawText);
        } catch (parseError) {
            console.error('[ERROR] Respuesta no JSON de Central One:', rawText);
            return res.status(502).json({
                success: false,
                message: 'El proveedor externo devolvió una respuesta no válida.',
                raw: rawText
            });
        }

        if (!response.ok) {
            console.error('=== RECHAZO DE CENTRAL ONE ===');
            console.error(JSON.stringify(responseData, null, 2));
            console.error('==============================');

            return res.status(response.status).json({
                success: false,
                message: responseData.message || 'Central One rechazó la solicitud de orden.',
                detail: responseData
            });
        }

        console.log('[ÉXITO] Orden procesada correctamente:', responseData);
        return res.status(200).json({
            success: true,
            message: 'Recarga procesada con éxito.',
            order: responseData.order || responseData
        });

    } catch (error) {
        console.error('[EXCEPCIÓN EN SERVIDOR]:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Error interno en el servidor.',
            error: error.message
        });
    }
});

// Ruta de compatibilidad
app.post('/api/recharge', async (req, res) => {
    req.body.catalog_item_id = req.body.catalog_item_id || req.body.optionId;
    req.body.player_id = req.body.player_id || req.body.playerId;
    res.redirect(307, '/api/crear-pedido');
});

app.listen(PORT, () => {
    console.log(`Servidor Sokov MC Digital activo en puerto ${PORT}`);
});
