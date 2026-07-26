-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('GCASH', 'MAYA', 'BANK_TRANSFER');

-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "payment_details" TEXT,
ADD COLUMN     "payment_method_type" "PaymentMethodType";
