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

        console.log(`[PETICIÓN INICIADA] Procesando recarga para ID: ${playerId}, Opción: ${optionId}`);

        const response = await fetch('https://api.centraloneglobal.com/v1/orders', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CENTRAL_ONE_API_KEY}`,
                'Content-Type': 'json'
            },
            body: JSON.stringify({
                product_id: optionId,
                player_id: playerId
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.log('--- DETALLE COMPLETO DE CAMPOS RECHAZADOS POR CENTRAL ONE ---');
            console.log(JSON.stringify(data, null, 2));
            console.log('------------------------------------------------------------');
            
            return res.status(response.status).json({
                success: false,
                message: 'Error en la respuesta del proveedor.',
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
