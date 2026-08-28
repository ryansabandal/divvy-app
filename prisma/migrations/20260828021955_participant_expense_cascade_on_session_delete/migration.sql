-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_session_id_fkey";

-- DropForeignKey
ALTER TABLE "Participant" DROP CONSTRAINT "Participant_session_id_fkey";

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
