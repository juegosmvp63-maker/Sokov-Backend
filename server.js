const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

// Endpoint para procesar el pedido con Central One
app.post('/api/crear-pedido', async (req, res) => {
    try {
        const { catalog_item_id, player_id, reseller_note } = req.body;

        if (!catalog_item_id || !player_id) {
            return res.status(400).json({ success: false, message: 'Faltan datos requeridos (catalog_item_id o player_id).' });
        }

        // Endpoint oficial de Central One Global para creación de órdenes
        const providerUrl = "https://portal.centraloneglobal.com/api/v1/orders";
        const apiKey = process.env.CENTRAL_ONE_API_KEY;

        if (!apiKey) {
            console.error("Error: CENTRAL_ONE_API_KEY no está configurada en las variables de entorno.");
            return res.status(500).json({ success: false, message: 'Error de configuración en el servidor.' });
        }

        // Petición POST según estructura oficial de Central One
        const payload = {
            catalog_item_id: catalog_item_id,
            player_id: player_id,
            reseller_note: reseller_note || `Pedido SokovMC Digital - ID: ${player_id}`
        };

        const apiResponse = await fetch(providerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload)
        });

        const resultado = await apiResponse.json();

        if (apiResponse.ok) {
            console.log('Orden Central One creada exitosamente:', resultado);
            res.json({ 
                success: true, 
                message: '¡Recarga procesada y enviada automáticamente!', 
                order: resultado.order || resultado 
            });
        } else {
            console.error('Error reportado por Central One:', resultado);
            res.status(400).json({ 
                success: false, 
                message: resultado.message || 'Error al procesar con la API del proveedor.' 
            });
        }

    } catch (error) {
        console.error('Error interno en el servidor:', error);
        res.status(500).json({ success: false, message: 'Error interno de conexión con el proveedor.' });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Servidor SokovMC Digital activo en el puerto ${PORT}`);
});
