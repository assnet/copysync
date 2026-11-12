-- Origem HUNTER (caçador de ofertas). Migration própria: o valor novo de enum não pode ser usado
-- na mesma transação em que é adicionado. Oferta HUNTER não conta no limite diário do gerador.
ALTER TYPE "OfferOrigin" ADD VALUE 'HUNTER';
