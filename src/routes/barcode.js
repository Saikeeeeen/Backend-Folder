import express from 'express';
import db from '../db.js';

const router = express.Router();

const findProductByBarcode = (barcode, res) => {
  if (!barcode || barcode.trim() === '') {
    return res.status(400).json({ error: 'Barcode is required' });
  }

  db.get(
    `SELECT 
      id, 
      name, 
      item_code, 
      barcode, 
      price, 
      cost, 
      quantity, 
      category_id, 
      brand_id, 
      unit_id 
     FROM products 
     WHERE item_code = ? OR barcode = ? 
     LIMIT 1`,
    [barcode, barcode],
    (err, row) => {
      if (err) {
        console.error('Barcode scan error:', err);
        return res.status(500).json({ error: 'Database error during barcode lookup' });
      }

      if (!row) {
        return res.status(404).json({ error: 'Product not found for barcode: ' + barcode });
      }

      return res.json({
        success: true,
        product: row,
      });
    }
  );
};

/**
 * Scan endpoint - Fetch product by barcode or item code
 * GET /api/products/scan/:barcode
 * GET /api/products/scan?barcode=12345
 * GET /api/scan/:barcode
 * GET /api/scan?barcode=12345
 *
 * Response:
 * {
 *   id: number,
 *   name: string,
 *   item_code: string,
 *   barcode: string,
 *   price: number,
 *   cost: number,
 *   quantity: number,
 *   category_id: number,
 *   brand_id: number,
 *   unit_id: number
 * }
 *
 * Error Responses:
 * 404 - Product not found
 * 500 - Database error
 */
router.get('/scan/:barcode?', (req, res) => {
  const barcode = req.params.barcode ?? req.query.barcode;

  return findProductByBarcode(barcode, res);
});

/**
 * Batch scan endpoint - Fetch multiple products by barcodes
 * POST /api/products/scan-batch
 * POST /api/scan-batch
 *
 * Request Body:
 * {
 *   barcodes: string[]
 * }
 *
 * Response:
 * {
 *   success: boolean,
 *   products: Array<product>,
 *   notFound: string[]
 * }
 */
router.post('/scan-batch', (req, res) => {
  const { barcodes } = req.body;

  const normalizedBarcodes = barcodes
    .map((code) => String(code).trim())
    .filter((code) => code.length > 0);

  // Validate input
  if (!Array.isArray(barcodes) || normalizedBarcodes.length === 0) {
    return res.status(400).json({ error: 'Barcodes array is required and must not be empty' });
  }

  if (normalizedBarcodes.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 barcodes per request' });
  }

  const placeholders = normalizedBarcodes.map(() => '(item_code = ? OR barcode = ?)').join(' OR ');
  const params = [];
  normalizedBarcodes.forEach((code) => {
    params.push(code, code);
  });

  db.all(
    `SELECT 
      id, 
      name, 
      item_code, 
      barcode, 
      price, 
      cost, 
      quantity, 
      category_id, 
      brand_id, 
      unit_id 
     FROM products 
     WHERE ${placeholders}`,
    params,
    (err, rows) => {
      if (err) {
        console.error('Batch barcode scan error:', err);
        return res.status(500).json({ error: 'Database error during batch barcode lookup' });
      }

      const foundBarcodes = new Set(
        rows.flatMap((row) => [row.item_code, row.barcode])
      );
      const notFound = normalizedBarcodes.filter((code) => !foundBarcodes.has(code));

      res.json({
        success: true,
        products: rows || [],
        notFound: notFound,
        count: rows ? rows.length : 0,
      });
    }
  );
});

export default router;
