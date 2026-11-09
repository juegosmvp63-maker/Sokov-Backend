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

        console.log(`[PETICIÓN] Recibido playerId: "${playerId}", optionId: "${optionId}"`);

        // Probemos enviando las variantes comunes que usan las APIs de recarga (product_id, sku, player_id, account_id, target)
        const payload = {
            product_id: optionId,
            player_id: playerId,
            account_id: playerId,
            target: playerId
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
        console.log('--- RESPUESTA DE CENTRAL ONE ---');
        console.log(`Status HTTP: ${response.status}`);
        console.log(rawText);
        console.log('--------------------------------');

        let data;
        try {
            data = JSON.parse(rawText);
        } catch (e) {
            return res.status(response.status).json({
                success: false,
                message: 'Respuesta no válida del proveedor',
                rawResponse: rawText
            });
        }

        if (!response.ok) {
            return res.status(response.status).json({
                success: false,
                message: data.message || 'Error al procesar la orden con Central One',
                detail: data
            });
        }

        console.log('[ORDEN CREADA EXITOSAMENTE]', data);
        res.json({ success: true, data });

    } catch (error) {
        console.error('[ERROR INTERNO]:', error.message);
        res.status(500).json({ success: false, message: 'Error interno en el servidor.', error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor SokovMC Digital activo en el puerto ${PORT}`);
});
