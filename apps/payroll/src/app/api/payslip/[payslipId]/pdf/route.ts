import { withUserContext } from "@bp/core";
import { toBigInt } from "@bp/ledger";
import { NextResponse } from "next/server";
import { getCurrentPersona } from "../../../../../lib/session";
import { renderPayslipPdf } from "../../../../../payslipPdf";

export async function GET(_request: Request, { params }: { params: Promise<{ payslipId: string }> }) {
  const { payslipId } = await params;
  const persona = await getCurrentPersona();
  if (!persona) return new NextResponse("unauthorized", { status: 401 });

  const pdf = await withUserContext(persona.id, async (client) => {
    const payslipResult = await client.query<{
      run_id: string;
      employee_id: string;
      gross: string;
      net: string;
    }>("select run_id, employee_id, gross, net from payslips where id = $1", [payslipId]);
    const payslip = payslipResult.rows[0];
    if (!payslip) return null;

    const employeeResult = await client.query<{
      id: string;
      org_id: string;
      staff_number: string;
      full_name: string;
      nationality: string;
      employee_type: string;
      pension_opt_in: boolean;
      nhf_opt_in: boolean;
      hire_date: string;
      termination_date: string | null;
    }>("select * from employees where id = $1", [payslip.employee_id]);
    const employee = employeeResult.rows[0];
    if (!employee) return null;

    const runResult = await client.query<{ period: string }>("select period from payroll_runs where id = $1", [payslip.run_id]);
    const period = runResult.rows[0]?.period ?? "";

    const lineRows = await client.query<{ code: string; name: string; type: string; amount: string }>(
      "select code, name, type, amount from payslip_lines where payslip_id = $1 order by id",
      [payslipId],
    );

    return renderPayslipPdf({
      employee: {
        id: employee.id,
        orgId: employee.org_id,
        staffNumber: employee.staff_number,
        fullName: employee.full_name,
        nationality: employee.nationality,
        employeeType: employee.employee_type,
        pensionOptIn: employee.pension_opt_in,
        nhfOptIn: employee.nhf_opt_in,
        hireDate: employee.hire_date,
        terminationDate: employee.termination_date,
      },
      period,
      currency: "NGN",
      gross: toBigInt(payslip.gross),
      net: toBigInt(payslip.net),
      lines: lineRows.rows.map((l) => ({
        code: l.code,
        name: l.name,
        type: l.type as "earning" | "deduction" | "employer_liability" | "accrual" | "relief" | "input",
        amount: toBigInt(l.amount),
      })),
    });
  });

  if (!pdf) return new NextResponse("not found", { status: 404 });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="payslip.pdf"`,
    },
  });
}
