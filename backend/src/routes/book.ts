import type { Request, Response } from 'express';

/** POST /book { cardId: string }
 *
 * Stub for now — simulates the delay of a real add-to-cart action. The real
 * implementation will resume the winning card's live browser tab (opened
 * during /search/stream) and drive it through fare selection to Alaska's
 * add-to-cart page; that gets wired in once Alaska's selectors are known.
 */
export function handleBook(req: Request, res: Response): void {
  const { cardId } = req.body ?? {};
  if (!cardId || typeof cardId !== 'string') {
    res.status(400).json({ error: 'Missing required body field: cardId' });
    return;
  }

  setTimeout(() => {
    res.json({ status: 'added_to_cart' });
  }, 600 + Math.round(Math.random() * 400));
}
