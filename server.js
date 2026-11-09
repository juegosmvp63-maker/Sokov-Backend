const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CENTRAL_ONE_API_KEY = process.env.CENTRAL_ONE_API_KEY;

app.post('/api/recharge', async (req, res) => {
    try {
        const { playerId, optionId } = req.body;

        if (!CENTRAL_ONE_API_KEY) {
            console.error('Error: No se ha configurado CENTRAL_ONE_API_KEY en las variables de entorno.');
            return res.status(500).json({ success: false, message: 'Configuración de API Key ausente en el servidor.' });
        }

        console.log(`[PETICIÓN INICIADA] playerId: "${playerId}", optionId: "${optionId}"`);

        // Central One requiere la estructura específica en el body (ej: sku / external_id / target)
        // Imprimimos exactamente la respuesta de error completa devuelta por el API
        const payload = {
            product_id: optionId,
            player_id: playerId,
            target: playerId,
            sku: optionId
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
        console.log('--- RESPUESTA CRUDA CENTRAL ONE ---');
        console.log(rawText);
        console.log('------------------------------------');

        let data;
        try {
            data = JSON.parse(rawText);
        } catch (e) {
            return res.status(response.status).json({
                success: false,
                message: 'El proveedor devolvió una respuesta no válida.',
                rawResponse: rawText
            });
        }

        if (!response.ok) {
            return res.status(response.status).json({
                success: false,
                message: 'Error reportado por Central One',
                detail: data
            });
        }

        console.log('[RECARGA EXITOSA]', data);
        res.json({ success: true, data });

    } catch (error) {
        console.error('[ERROR EN SERVIDOR]:', error.message);
        res.status(500).json({ success: false, message: 'Error interno en el servidor.', error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor SokovMC Digital activo en el puerto ${PORT}`);
});
