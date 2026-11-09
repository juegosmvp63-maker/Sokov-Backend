/**
 * ==============================================================================
 * SOKOV MC DIGITAL - SERVIDOR BACKEND OFICIAL (NODE.JS / EXPRESS)
 * Integración con Central One Global API para Recargas Automáticas
 * ==============================================================================
 */

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();

// Configuración de middlewares
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CENTRAL_ONE_API_KEY = process.env.CENTRAL_ONE_API_KEY;

// Ruta de verificación de estado del servidor
app.get('/', (req, res) => {
    res.json({ 
        status: 'online', 
        store: 'Sokov MC Digital', 
        message: 'Servidor backend operando correctamente y conectado a Central One' 
    });
});

// Ruta principal para procesar recargas automáticas
app.post('/api/recharge', async (req, res) => {
    try {
        const { playerId, optionId } = req.body;

        // Validación de datos de entrada desde el frontend
        if (!playerId || !optionId) {
            return res.status(400).json({
                success: false,
                message: 'Faltan parámetros obligatorios: playerId u optionId.'
            });
        }

        // Validación de la API Key en las variables de entorno de Render
        if (!CENTRAL_ONE_API_KEY) {
            console.error('[ERROR CRÍTICO] La variable CENTRAL_ONE_API_KEY no está configurada.');
            return res.status(500).json({
                success: false,
                message: 'Error de configuración interna del servidor.'
            });
        }

        console.log(`[SOKOV MC] Iniciando recarga -> Jugador ID: ${playerId} | Producto ID: ${optionId}`);

        // Estructura de la petición exigida por Central One Global API (v1/orders)
        const payload = {
            product_id: optionId,
            player_id: playerId
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

        // Si Central One rechaza la orden, registramos el detalle exacto
        if (!response.ok) {
            console.error('=== RECHAZO DE CENTRAL ONE (INVALID REQUEST) ===');
            console.error(JSON.stringify(responseData, null, 2));
            console.error('================================================');

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
            data: responseData
        });

    } catch (error) {
        console.error('[EXCEPCIÓN EN SERVIDOR]:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Error interno en el servidor al procesar la recarga.',
            error: error.message
        });
    }
});

// Inicialización del servidor escuchando en el puerto asignado
app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(` Sokov MC Digital Backend activo en puerto ${PORT} `);
    console.log(`==================================================`);
});
