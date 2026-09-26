"""Policy pages: privacy, terms, cancellation and the vendor agreement.

Served from the API rather than hard-coded in the frontend so the company
name, contact points and the actual money rules come from admin settings. A
policy that states a cancellation fee the engine does not charge is worse than
no policy at all, so the numbers here are read live from the same settings the
booking code uses.

Written for this business. Not legal advice — have a lawyer review before you
rely on it, particularly the DPDP grievance-officer requirements.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.services import settings_service

router = APIRouter(prefix="/legal", tags=["legal"])


def _hours(n: int) -> str:
    """"1 hour" / "2 hours" — never "1 hour(s)", which reads like a form field."""
    return f"{n} hour" if n == 1 else f"{n} hours"


def _section(heading: str, body: list[str]) -> dict:
    return {"heading": heading, "body": body}


@router.get("/privacy", summary="Privacy policy")
async def privacy() -> dict:
    settings = await settings_service.get_settings()
    company = settings.company
    privacy_cfg = settings.privacy
    return {
        "title": "Privacy Policy",
        "subtitle": f"How {company.legal_name} handles your information",
        "updated": privacy_cfg.policy_updated,
        "sections": [
            _section(
                "1. What we collect",
                [
                    "Your name, phone number and email address when you create an account.",
                    "Pickup and drop addresses for the trips you book, and any addresses you "
                    "choose to save.",
                    "Booking and payment records, including the amounts paid and the method used.",
                    "For drivers and vehicle owners: licence and vehicle documents, and the bank "
                    "details you give us so we can pay you.",
                ],
            ),
            _section(
                "2. Why we collect it",
                [
                    "To arrange the trip you asked for, and to let the driver find you.",
                    "To take payment, issue refunds, and keep an accurate record of both.",
                    "To verify that drivers are licensed and vehicles are roadworthy.",
                    "To answer your support requests and resolve disputes.",
                ],
            ),
            _section(
                "3. What we share, and what we never share",
                [
                    "Your first name and pickup location are shared with the driver assigned to "
                    "your trip.",
                    "Your phone number is released to that driver only shortly before the pickup "
                    "time, or once the trip is under way. Before then they see a masked number.",
                    "Payment details are handled by our payment provider. We never see or store "
                    "your full card number.",
                    "We do not sell your information, and we do not share it for advertising.",
                ],
            ),
            _section(
                "4. How long we keep it",
                [
                    "Booking and payment records are kept as long as tax and accounting rules "
                    "require.",
                    "You can ask us to close your account at any time. We then remove your "
                    "profile and saved addresses, keeping only the transaction records we are "
                    "obliged to retain.",
                ],
            ),
            _section(
                "5. Your rights",
                [
                    "You can ask what we hold about you, correct it, or ask us to delete it.",
                    "You can withdraw consent for anything that is not required to run a trip you "
                    "have already booked.",
                    f"To exercise any of these, contact {privacy_cfg.grievance_email}.",
                ],
            ),
            _section(
                "6. Security",
                [
                    "Passwords are stored hashed and are never readable, by us or anyone else.",
                    "Bank account numbers are masked everywhere in the app; only the last four "
                    "digits are shown.",
                    "Access to customer data is limited to staff who need it to do their job.",
                ],
            ),
            _section(
                "7. Grievance officer",
                [
                    f"{privacy_cfg.grievance_officer}",
                    f"{privacy_cfg.grievance_email}",
                    f"{company.address}",
                    "We aim to acknowledge complaints within 48 hours.",
                ],
            ),
        ],
    }


@router.get("/terms", summary="Terms of service")
async def terms() -> dict:
    settings = await settings_service.get_settings()
    company = settings.company
    rules = settings.cancellation
    options = settings.payment_options
    advance = settings.advance
    return {
        "title": "Terms of Service",
        "subtitle": "For customers booking a trip",
        "updated": settings.privacy.policy_updated,
        "sections": [
            _section(
                "1. Who we are",
                [
                    f"{company.legal_name} arranges outstation, airport and local trips with "
                    "verified drivers and vehicles.",
                    f"Support: {company.support_phone} · {company.support_email}. "
                    f"Hours: {company.working_hours}.",
                ],
            ),
            _section(
                "2. Booking a trip",
                [
                    "A booking is a request until our team confirms a vehicle is available.",
                    "Fares are quoted before you book and are calculated by us, not by the driver.",
                    "Unless stated otherwise on the fare breakdown, tolls, parking and state "
                    "permits are charged separately from the quoted fare.",
                ],
            ),
            _section(
                "3. Paying",
                [
                    "Pay later — nothing now; settle the full fare with the driver."
                    if options.allow_pay_later
                    else "Settling with the driver is not available on this service.",
                    f"Part payment — {advance.percent:.0f}% now to hold the vehicle, the rest at "
                    "the end of the trip."
                    if options.allow_part_payment
                    else "Part payment is not available on this service.",
                    "Full payment — the whole fare now."
                    if options.allow_full_payment
                    else "Paying in full up front is not available on this service.",
                    "Whatever you pay online is taken through a secure payment provider.",
                ],
            ),
            _section(
                "4. Cancelling",
                [
                    f"Cancel more than {rules.customer_free_hours} hours before pickup and any "
                    "amount you have paid is refunded in full.",
                    f"Cancel within {rules.customer_free_hours} hours of pickup and we keep "
                    f"{rules.customer_fee_percent:.0f}% of the amount already paid; the rest is "
                    "refunded.",
                    "Refunds go back to the account you paid from and usually take 5–7 working "
                    "days to appear.",
                    "Once a trip has started it cannot be cancelled in the app — call support.",
                ],
            ),
            _section(
                "5. If we cancel",
                [
                    "If we cannot supply a vehicle, you are refunded in full.",
                    "If a driver drops your trip, it returns to our pool and we assign another "
                    "vehicle. You are not charged for the change.",
                ],
            ),
            _section(
                "6. Your responsibilities",
                [
                    "Give an accurate pickup address and a reachable phone number.",
                    "Be ready at the pickup time. Waiting beyond a reasonable period may incur a "
                    "charge or count as a no-show.",
                    "Treat the driver and vehicle with respect. Smoking and alcohol are not "
                    "permitted in the vehicle.",
                ],
            ),
            _section(
                "7. Limits",
                [
                    f"{company.legal_name} arranges the trip and is responsible for the service "
                    "we provide. We are not liable for delays caused by traffic, weather, road "
                    "closures or other things outside our control.",
                    "These terms are governed by the laws of India.",
                ],
            ),
        ],
    }


@router.get("/vendor-terms", summary="Driver and vehicle owner agreement")
async def vendor_terms() -> dict:
    settings = await settings_service.get_settings()
    company = settings.company
    wallet = settings.wallet
    rules = settings.cancellation
    return {
        "title": "Driver & Owner Agreement",
        "subtitle": "For drivers and vehicle owners on the platform",
        "updated": settings.privacy.policy_updated,
        "sections": [
            _section(
                "1. Eligibility",
                [
                    "You must have at least one approved driver and one approved vehicle, with a "
                    "valid licence, registration and insurance on file.",
                    "We may decline or withdraw approval where documents are missing, expired or "
                    "cannot be verified.",
                ],
            ),
            _section(
                "2. Wallet and minimum balance",
                [
                    f"You must keep at least ₹{wallet.min_balance:,.0f} in your wallet to accept "
                    "trips. This is a floor you retain, not a fee we take.",
                    f"Accepting a trip holds a further amount against it — "
                    f"{wallet.per_ride_percent:.0f}% of the fare, with a minimum of "
                    f"₹{wallet.per_ride_min:,.0f}. The hold is released when the trip ends.",
                    "Held money is not available to withdraw while the trip is live.",
                ],
            ),
            _section(
                "3. Cancellation charges",
                [
                    "Charges depend on how close to the pickup you cancel, because that is what "
                    "decides whether we can find another vehicle in time:",
                    f"Within {rules.driver_grace_minutes} minutes of accepting — "
                    f"₹{rules.driver_grace_penalty:,.0f}.",
                    f"Later, but more than {_hours(rules.driver_late_hours)} before pickup — "
                    f"₹{rules.driver_late_penalty:,.0f}.",
                    f"Within {_hours(rules.driver_late_hours)} of pickup — "
                    f"₹{rules.driver_critical_penalty:,.0f}.",
                    "The charge is deducted from your wallet and shown in your statement with "
                    "the reason.",
                ],
            ),
            _section(
                "4. Payouts and withdrawals",
                [
                    "Your share of a trip is credited to your wallet by our operations team.",
                    "You can request a withdrawal of any available balance at any time. We "
                    "transfer it to the bank account on your profile and then debit the wallet, "
                    "so your balance only changes once the money has actually moved.",
                    "Keep your bank details current — we cannot pay you without them.",
                ],
            ),
            _section(
                "5. Customer information",
                [
                    "You receive the customer's name and pickup location when a trip is assigned.",
                    "Their phone number is released shortly before the pickup time, or once the "
                    "trip is under way.",
                    "Customer contact details are for completing the trip only. Using them for "
                    "anything else, or keeping them afterwards, ends your access to the platform.",
                ],
            ),
            _section(
                "6. Conduct",
                [
                    "Drive lawfully, keep the vehicle clean and roadworthy, and keep documents "
                    "current.",
                    "Repeated cancellations, safety complaints or document lapses may result in "
                    "suspension of a driver, a vehicle, or your account.",
                ],
            ),
            _section(
                "7. Contact",
                [
                    f"{company.support_phone} · {company.support_email}",
                    f"{company.address}",
                ],
            ),
        ],
    }


@router.get("/wallet-rules", summary="The wallet terms, for the driver wallet screen")
async def wallet_rules() -> dict:
    """The money rules a driver is held to, in one small payload.

    Pulled from the same settings the agreement and the wallet engine read, so
    the note on the wallet screen cannot quietly disagree with the policy page
    or with what the code actually charges.
    """
    settings = await settings_service.get_settings()
    wallet = settings.wallet
    rules = settings.cancellation
    return {
        "min_balance": wallet.min_balance,
        "per_ride_percent": wallet.per_ride_percent,
        "per_ride_min": wallet.per_ride_min,
        "points": [
            {
                "title": "The minimum is yours, not a fee",
                "body": (
                    f"Keep at least ₹{wallet.min_balance:,.0f} to accept trips. It stays your "
                    "money and you can withdraw it whenever it is not held."
                ),
            },
            {
                "title": "Each trip holds part of it",
                "body": (
                    f"Accepting a trip holds {wallet.per_ride_percent:.0f}% of the fare "
                    f"(at least ₹{wallet.per_ride_min:,.0f}) until the trip ends. Held money "
                    "cannot be withdrawn while the trip is live."
                ),
            },
            {
                "title": "Cancelling costs you",
                "body": (
                    f"Within {rules.driver_grace_minutes} minutes of accepting, "
                    f"₹{rules.driver_grace_penalty:,.0f}. Later, "
                    f"₹{rules.driver_late_penalty:,.0f}. "
                    + (
                        f"Within {_hours(rules.driver_late_hours)} of pickup you are charged the "
                        "whole trip fare, which can leave your balance negative."
                        if rules.driver_critical_is_full_fare
                        else f"Within {_hours(rules.driver_late_hours)} of pickup, "
                        f"₹{rules.driver_critical_penalty:,.0f}."
                    )
                ),
            },
            {
                "title": "A negative balance blocks new work",
                "body": (
                    "If a charge takes you below the minimum you cannot accept trips until you "
                    "top up. Nothing else is affected."
                ),
            },
            {
                "title": "Getting paid out",
                "body": (
                    "Your share of a trip is credited here by the office. Request a withdrawal "
                    "and we transfer it to your account — the balance drops once the money has "
                    "actually moved, not before."
                ),
            },
        ],
    }
