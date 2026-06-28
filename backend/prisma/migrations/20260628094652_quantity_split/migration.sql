-- AlterEnum
ALTER TYPE "SplitType" ADD VALUE 'QUANTITY';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "quantity" INTEGER;

-- AlterTable
ALTER TABLE "ExpenseSplit" ADD COLUMN     "units" INTEGER;
