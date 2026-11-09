/**
 * ==============================================================================
 * SOKOV MC DIGITAL - SERVIDOR BACKEND OFICIAL (NODE.JS / EXPRESS)
 * Integración con Central One Global API (Versión Producción Definitiva)
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

// 1. Ruta raíz para verificar estado del servidor backend
app.get('/', (req, res) => {
    res.json({ 
        status: 'online', 
        store: 'Sokov MC Digital', 
        message: 'Servidor backend operando correctamente y conectado a Central One' 
    });
});

// 2. Endpoint para consultar el catálogo oficial de productos (UUIDs)
app.get('/api/v1/catalog', async (req, res) => {
    try {
        if (!CENTRAL_ONE_API_KEY) {
            return res.status(500).json({ success: false, message: 'Falta CENTRAL_ONE_API_KEY en Render.' });
        }
        const response = await fetch(`${CENTRAL_ONE_BASE_URL}/catalog`, {
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

// 3. Endpoint opcional para validar cuenta / jugador
app.post('/api/v1/player/validate', async (req, res) => {
    try {
        const { product_id, player_id } = req.body;
        if (!product_id || !player_id) {
            return res.status(400).json({ success: false, message: 'Faltan parámetros: product_id o player_id.' });
        }

        const response = await fetch(`${CENTRAL_ONE_BASE_URL}/player/validate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CENTRAL_ONE_API_KEY}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                product_id: product_id,
                target_payload: { player_id: player_id }
            })
        });

        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 4. Ruta principal para crear y procesar pedidos automáticos
app.post('/api/crear-pedido', async (req, res) => {
    try {
        const { catalog_item_id, player_id, note } = req.body;

        if (!catalog_item_id || !player_id) {
            return res.status(400).json({
                success: false,
                message: 'Faltan parámetros obligatorios: catalog_item_id o player_id.'
            });
        }

        if (!CENTRAL_ONE_API_KEY) {
            console.error('[ERROR CRÍTICO] La variable CENTRAL_ONE_API_KEY no está configurada en Render.');
            return res.status(500).json({
                success: false,
                message: 'Error de configuración interna del servidor (API Key faltante).'
            });
        }

        console.log(`[SOKOV MC DIGITAL] Creando orden -> UUID: ${catalog_item_id} | ID Jugador: ${player_id}`);

        const idempotencyKey = crypto.randomUUID();

        // Payload estricto según la especificación oficial de Central One
        const payload = {
            items: [
                {
                    catalog_item_id: catalog_item_id,
                    quantity: 1,
                    target_payload: {
                        player_id: player_id
                    }
                }
            ],
            note: note || 'Sokov MC Digital - Recarga Automatizada'
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
            console.error('[ERROR] Respuesta no JSON recibida de Central One:', rawText);
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

        console.log('[ÉXITO] Orden procesada correctamente por Central One:', responseData);
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

// 5. Ruta de compatibilidad para peticiones antiguas
app.post('/api/recharge', async (req, res) => {
    req.body.catalog_item_id = req.body.catalog_item_id || req.body.optionId;
    req.body.player_id = req.body.player_id || req.body.playerId;
    res.redirect(307, '/api/crear-pedido');
});

// Inicialización del servidor
app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(` Sokov MC Digital Backend activo en puerto ${PORT} `);
    console.log(` Conectado a Central One Portal API v1            `);
    console.log(`==================================================`);
});
