const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// In-memory or temporary database store for orders (replace with your DB logic if needed)
let pendingOrders = [];

// Ruta principal de prueba
app.get('/', (req, res) => {
    res.send('Sokovm Backend is running live!');
});

// Endpoint para recibir las notificaciones del banco (Webhook de la app Android)
app.post('/api/bank/auto-approve', (req, res) => {
    try {
        console.log('Webhook recibido:', req.body);
        
        // La app Android envía la notificación completa en 'reference' o 'msg'
        const rawMessage = req.body.reference || req.body.msg || JSON.stringify(req.body);
        
        // Extraer número de referencia (ej: 4 u 8 dígitos típicos de pago móvil en Venezuela, o buscar patrones)
        // Ejemplo genérico para capturar números de referencia
        const matchRef = rawMessage.match(/\b\d{4,8}\b/);
        const reference = matchRef ? matchRef[0] : null;

        if (!reference) {
            return res.status(400).json({ 
                success: false, 
                message: 'No se pudo extraer la referencia del mensaje.',
                received: rawMessage 
            });
        }

        console.log(`Referencia extraída con éxito: ${reference}`);

        // Aquí puedes agregar la lógica para buscar la orden pendiente con esta referencia
        // y proceder con la aprobación automática y Central One.

        return res.status(200).json({ 
            success: true, 
            message: `Pago con referencia ${reference} procesado correctamente.` 
        });

    } catch (error) {
        console.error('Error procesando webhook:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
