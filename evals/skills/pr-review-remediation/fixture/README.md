# shopcart

Cart pricing library. Amounts are integer cents.

## Pricing rules

- **Bulk discount:** a line of 10 or more units of one item gets 15% off the line total. A line of 9 or fewer units gets no discount.
- **Tax:** 8% of the subtotal, rounded to the nearest cent (not down), as covered by `tests/tax.cases.js`.
- **Shipping:** flat 500 cents per order, capped by the carrier at 2500 cents; a free-shipping order (subtotal of 10000 cents or more) ships for 0.

Run the tests with `npm test`.
