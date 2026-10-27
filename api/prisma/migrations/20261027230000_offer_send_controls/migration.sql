-- Pausar / retomar / parar o envio de uma oferta
ALTER TYPE "OfferStatus" ADD VALUE 'PAUSED';
ALTER TYPE "OfferStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "OfferDispatchStatus" ADD VALUE 'CANCELLED';
