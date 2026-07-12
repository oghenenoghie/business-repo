import type { RuleSet } from "../types.js";

// Nigeria, rule set version NG-2026-01. Effective 2026-01-01.
//
// Sources (verified by web search against multiple independent, converging
// reports — professional/law-firm tax alerts and a fact-check specifically
// confirming this band structure — since the underlying legislation could
// not be fetched directly in this environment; re-verify against the
// primary gazette before this is used for anything beyond this portfolio):
//
// - PAYE bands: Nigeria Tax Act, 2025 (Act No. 7 of 2025), Fourth Schedule
//   (Section 58), effective 2026-01-01. First ₦800,000 at 0%, next
//   ₦2,200,000 at 15%, next ₦9,000,000 at 18%, next ₦13,000,000 at 21%,
//   next ₦25,000,000 at 23%, remainder at 25%. Cross-referenced via Baker
//   Tilly Nigeria's 2025 Tax Reform Acts explainer and Adeola Oyinlade & Co's
//   analysis of the Act; the ₦800,000 threshold and rate structure was also
//   independently confirmed by an Africa Check fact-check that verified it
//   against a claimed misrepresentation of the same law.
// - Rent relief: Nigeria Tax Act 2025, Section 30(2)(a)(vi) — 20% of annual
//   rent paid, capped at ₦500,000. Replaces the former Consolidated Relief
//   Allowance entirely.
// - Pension: Pension Reform Act 2014, Section 4 — employee 8%, employer 10%,
//   of "monthly emolument" (basic + housing + transport allowances).
// - NHF: National Housing Fund Act, 2.5% of basic salary. Reported as
//   voluntary for private-sector employees and mandatory for public-sector
//   employees from 2026 — modeled here as opt-in via the `nhfOptIn` flag so
//   an app can set it per employee/sector rather than the rules engine
//   hardcoding a sector distinction.
// - NSITF: Employees' Compensation Act 2010 — employer-only, 1% of gross
//   monthly payroll.
// - ITF: Industrial Training Fund Act — employer-only, 1% of payroll, for
//   employers meeting the statutory threshold (turnover ≥ ₦50m or ≥5
//   employees). The real levy is remitted annually on the prior year's
//   total payroll; this rule set accrues it monthly as 1% of gross per run
//   as a simplification — see packages/rules/README.md "Not built yet".
//
// Currency: NGN, 2 decimal places (100 kobo = ₦1). All bigint values below
// are in kobo.

const rate = (numerator: bigint, denominator: bigint) => ({ numerator, denominator });

export const NG_2026: RuleSet = {
  jurisdiction: "NG",
  version: "NG-2026-01",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  currency: "NGN",
  roundingMode: "half_up",
  components: [
    { code: "BASIC", name: "Basic Salary", type: "earning", sequence: 10, calculation: { method: "from_snapshot", field: "BASIC" } },
    { code: "HOUSING", name: "Housing Allowance", type: "earning", sequence: 20, calculation: { method: "from_snapshot", field: "HOUSING" } },
    { code: "TRANSPORT", name: "Transport Allowance", type: "earning", sequence: 30, calculation: { method: "from_snapshot", field: "TRANSPORT" } },

    {
      code: "PENSIONABLE_EMOLUMENT",
      name: "Pensionable Emolument",
      type: "input",
      sequence: 40,
      calculation: { method: "sum_of", codes: ["BASIC", "HOUSING", "TRANSPORT"] },
    },

    {
      code: "PENSION_EMPLOYEE",
      name: "Pension (Employee)",
      type: "deduction",
      sequence: 50,
      appliesWhen: { flag: "pensionOptIn" },
      calculation: { method: "percentage_of", base: "PENSIONABLE_EMOLUMENT", rate: rate(8n, 100n) },
    },
    {
      code: "PENSION_EMPLOYER",
      name: "Pension (Employer)",
      type: "employer_liability",
      sequence: 60,
      appliesWhen: { flag: "pensionOptIn" },
      calculation: { method: "percentage_of", base: "PENSIONABLE_EMOLUMENT", rate: rate(10n, 100n) },
    },

    {
      code: "NHF",
      name: "National Housing Fund",
      type: "deduction",
      sequence: 70,
      appliesWhen: { flag: "nhfOptIn" },
      calculation: { method: "percentage_of", base: "BASIC", rate: rate(25n, 1000n) }, // 2.5%
    },

    {
      code: "ANNUAL_RENT",
      name: "Annual Rent Paid (input)",
      type: "input",
      sequence: 80,
      calculation: { method: "from_snapshot", field: "ANNUAL_RENT" },
    },
    {
      code: "RENT_RELIEF",
      name: "Rent Relief",
      type: "relief",
      sequence: 90,
      calculation: { method: "capped_percentage", base: "ANNUAL_RENT", rate: rate(20n, 100n), cap: 500_000_00n },
    },

    {
      code: "PAYE",
      name: "PAYE",
      type: "deduction",
      sequence: 100,
      calculation: {
        method: "graduated_bands",
        base: "GROSS",
        subtract: ["PENSION_EMPLOYEE", "NHF", "RENT_RELIEF"],
        annualize: true,
        bands: [
          { widthMinor: 800_000_00n, rate: rate(0n, 100n) },
          { widthMinor: 2_200_000_00n, rate: rate(15n, 100n) },
          { widthMinor: 9_000_000_00n, rate: rate(18n, 100n) },
          { widthMinor: 13_000_000_00n, rate: rate(21n, 100n) },
          { widthMinor: 25_000_000_00n, rate: rate(23n, 100n) },
          { widthMinor: null, rate: rate(25n, 100n) },
        ],
      },
    },

    {
      code: "NSITF",
      name: "NSITF (Employer)",
      type: "employer_liability",
      sequence: 110,
      calculation: { method: "percentage_of", base: "GROSS", rate: rate(1n, 100n) },
    },
    {
      code: "ITF",
      name: "Industrial Training Fund (Employer)",
      type: "employer_liability",
      sequence: 120,
      calculation: { method: "percentage_of", base: "GROSS", rate: rate(1n, 100n) },
    },
  ],
};
