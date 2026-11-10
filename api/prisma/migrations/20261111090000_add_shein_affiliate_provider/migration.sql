-- Marketplace SHEIN. Migration própria: valor novo de enum não pode ser usado na transação que o cria.
ALTER TYPE "AffiliateProvider" ADD VALUE 'SHEIN';
