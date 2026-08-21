-- CreateIndex
CREATE INDEX "Expense_session_id_idx" ON "Expense"("session_id");

-- CreateIndex
CREATE INDEX "Expense_paid_by_idx" ON "Expense"("paid_by");

-- CreateIndex
CREATE INDEX "ExpenseSplit_expense_id_idx" ON "ExpenseSplit"("expense_id");

-- CreateIndex
CREATE INDEX "ExpenseSplit_participant_id_idx" ON "ExpenseSplit"("participant_id");

-- CreateIndex
CREATE INDEX "Participant_session_id_idx" ON "Participant"("session_id");

-- CreateIndex
CREATE INDEX "Settlement_session_id_idx" ON "Settlement"("session_id");

-- CreateIndex
CREATE INDEX "Settlement_from_id_idx" ON "Settlement"("from_id");

-- CreateIndex
CREATE INDEX "Settlement_to_id_idx" ON "Settlement"("to_id");
