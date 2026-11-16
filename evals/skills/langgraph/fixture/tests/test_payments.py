import payments


def test_issue_refund_records_the_amount():
    payments.REFUNDS.clear()
    refund_id = payments.issue_refund("o-1", 25)
    assert payments.REFUNDS == [("o-1", 25)]
    assert refund_id == "refund-o-1"


def test_issue_refund_returns_one_id_per_order():
    assert payments.issue_refund("o-2", 5) != payments.issue_refund("o-3", 5)
