# Glossary

## Merchant

A Kenyan business that uses Peylora to collect, manage, monitor, and reconcile customer payments.

## Customer

A person or organisation represented in a Merchant's customer record. A Customer may be associated with an Invoice or a Payment Request.

The intended Customer associated with a Payment Request is not necessarily the actual person who initiates a payment through a public Payment Link. Payees, customers and public-link payers must therefore not be assumed to be the same identity.

Customer association is optional until an explicit business rule requires it.

## Digital Payments and Collections Platform

A merchant-focused product that brings together payment collection and the operational context needed to understand, manage, and reconcile those payments.

## Payment Collection

The process of requesting or receiving money from a customer through an accepted payment channel.

## Payment Request

A Merchant's request to collect a fixed amount. It may have an intended Customer, but Customer association is not required. A Payment Request may be standalone or associated with an Invoice. Multiple Payment Attempts may belong to one Payment Request.

Payment Request fulfillment is separate from the outcome of any one Payment Attempt. Confirmed amounts received across its Provider Transactions count cumulatively toward the requested amount. A Payment Request is fulfilled when those amounts meet or exceed the requested amount.

## Invoice

A formal billing document identifying the Customer, billed items, total amount, due date and outstanding financial position.

An Invoice can have multiple Payment Requests. Its balance reflects the amount allocated from successful Provider Transactions.

## Payment Attempt

An individual collection initiation associated with a Payment Request. Each STK initiation creates a separate Payment Attempt, with its own provider identifiers and operational events. Cancelled and failed attempts remain in history.

An unsuccessful initiation or network timeout does not necessarily produce a Provider Transaction.

An uncertain timed-out Payment Attempt is not evidence of non-payment. It may be retried after a final provider status result or an authorized operator resolution. If there is no provider identifier that permits a status query, operator review is required before retry.

## Provider Transaction

An external provider's recorded transaction and associated confirmed outcome, including provider identifiers, requested amount, amount received, receipt and confirmation details.

Provider callbacks and provider status queries are evidence used to establish a Provider Transaction or the outcome of a Payment Attempt. They are distinct from the attempt itself.

A successful provider response describes the provider outcome. It does not by itself prove that an Invoice is fully paid or that funds have settled to the Merchant.

## Payment Allocation

The portion of an actual amount received that is assigned to an Invoice or another collection obligation. Allocated and unallocated amounts are tracked separately.

## Customer Credit

An amount received from a Customer that remains after satisfying one or more collection obligations. Customer Credit must remain traceable and must not be silently discarded.

## Payment Link

A collection interface for a Payment Request. A Payment Link can expose a standalone or invoice-linked Payment Request and can be configured for single-use or reusable collection.

Each Payment Link points to one Payment Request. Reusable links allow additional Payment Attempts while that request remains unfulfilled. A single-use link is consumed after the first confirmed successful Provider Transaction, even if the amount received does not fulfill the request. New links default to reusable.

A Payment Link can be disabled independently of its associated Payment Request. Link expiration also does not by itself establish whether the underlying request expires.

Failed or cancelled attempts do not consume a single-use link. A fulfilled Payment Request must not accept further collections.

## Webhook Event

A persisted incoming event from an external provider or other integration that requires processing and possibly retry. The existing `webhook_events` table represents incoming provider callback events, including Daraja callbacks.

Future outgoing merchant webhook deliveries are separate operational records and delivery processes. Application notifications and general application events are not automatically Webhook Events.

## Settlement

The movement and availability of collected funds to the Merchant under the provider or banking arrangement. Settlement is a separate concept from provider payment confirmation.

## Reconciliation

The process of comparing provider outcomes, payment records and allocation records to confirm consistency and identify discrepancies. Reconciliation is distinct from financial settlement.

## Peylora

The product name. Peylora is a merchant-focused digital payments and collections platform for Kenyan businesses, with M-Pesa as the initial primary payment channel.
