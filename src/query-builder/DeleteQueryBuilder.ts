import { QueryBuilder } from "./QueryBuilder"
import { ObjectLiteral } from "../common/ObjectLiteral"
import { EntityTarget } from "../common/EntityTarget"
import { DataSource } from "../data-source/DataSource"
import { QueryRunner } from "../query-runner/QueryRunner"
import { WhereExpressionBuilder } from "./WhereExpressionBuilder"
import { Brackets } from "./Brackets"
import { DeleteResult } from "./result/DeleteResult"
import { ReturningStatementNotSupportedError } from "../error/ReturningStatementNotSupportedError"
import { InstanceChecker } from "../util/InstanceChecker"

/**
 * Allows to build complex sql queries in a fashion way and execute those queries.
 */
export class DeleteQueryBuilder<Entity extends ObjectLiteral>
    extends QueryBuilder<Entity>
    implements WhereExpressionBuilder
{
    readonly "@instanceof" = Symbol.for("DeleteQueryBuilder")

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(
        connectionOrQueryBuilder: DataSource | QueryBuilder<any>,
        queryRunner?: QueryRunner,
    ) {
        super(connectionOrQueryBuilder as any, queryRunner)
        this.expressionMap.aliasNamePrefixingEnabled = false
    }

    // -------------------------------------------------------------------------
    // Public Implemented Methods
    // -------------------------------------------------------------------------

    /**
     * Gets generated SQL query without parameters being replaced.
     */
    getQuery(): string {
        let sql = this.createComment()
        sql += this.createCteExpression()
        sql += this.createDeleteExpression()
        return this.replacePropertyNamesForTheWholeQuery(sql.trim())
    }

    /**
     * Executes sql generated by query builder and returns raw database results.
     */
    async execute(): Promise<DeleteResult> {
        const [sql, parameters] = this.getQueryAndParameters()
        const queryRunner = this.obtainQueryRunner()
        let transactionStartedByUs: boolean = false

        try {
            // start transaction if it was enabled
            if (
                this.expressionMap.useTransaction === true &&
                queryRunner.isTransactionActive === false
            ) {
                await queryRunner.startTransaction()
                transactionStartedByUs = true
            }

            // call before deletion methods in listeners and subscribers
            if (
                this.expressionMap.callListeners === true &&
                this.expressionMap.mainAlias!.hasMetadata
            ) {
                await queryRunner.broadcaster.broadcast(
                    "BeforeRemove",
                    this.expressionMap.mainAlias!.metadata,
                )
            }

            // execute query
            const queryResult = await queryRunner.query(sql, parameters, true)
            const deleteResult = DeleteResult.from(queryResult)

            // call after deletion methods in listeners and subscribers
            if (
                this.expressionMap.callListeners === true &&
                this.expressionMap.mainAlias!.hasMetadata
            ) {
                await queryRunner.broadcaster.broadcast(
                    "AfterRemove",
                    this.expressionMap.mainAlias!.metadata,
                )
            }

            // close transaction if we started it
            if (transactionStartedByUs) await queryRunner.commitTransaction()

            return deleteResult
        } catch (error) {
            // rollback transaction if we started it
            if (transactionStartedByUs) {
                try {
                    await queryRunner.rollbackTransaction()
                } catch (rollbackError) {
                    /* empty */
                }
            }
            throw error
        } finally {
            if (queryRunner !== this.queryRunner) {
                // means we created our own query runner
                await queryRunner.release()
            }
        }
    }

    // -------------------------------------------------------------------------
    // Public Methods
    // -------------------------------------------------------------------------

    /**
     * Specifies FROM which entity's table select/update/delete will be executed.
     * Also sets a main string alias of the selection data.
     */
    from<T extends ObjectLiteral>(
        entityTarget: EntityTarget<T>,
        aliasName?: string,
    ): DeleteQueryBuilder<T> {
        entityTarget = InstanceChecker.isEntitySchema(entityTarget)
            ? entityTarget.options.name
            : entityTarget
        const mainAlias = this.createFromAlias(entityTarget, aliasName)
        this.expressionMap.setMainAlias(mainAlias)
        return this as any as DeleteQueryBuilder<T>
    }

    /**
     * Sets WHERE condition in the query builder.
     * If you had previously WHERE expression defined,
     * calling this function will override previously set WHERE conditions.
     * Additionally you can add parameters used in where expression.
     */
    where(
        where:
            | Brackets
            | string
            | ((qb: this) => string)
            | ObjectLiteral
            | ObjectLiteral[],
        parameters?: ObjectLiteral,
    ): this {
        this.expressionMap.wheres = [] // don't move this block below since computeWhereParameter can add where expressions
        const condition = this.getWhereCondition(where)
        if (condition)
            this.expressionMap.wheres = [
                { type: "simple", condition: condition },
            ]
        if (parameters) this.setParameters(parameters)
        return this
    }

    /**
     * Adds new AND WHERE condition in the query builder.
     * Additionally you can add parameters used in where expression.
     */
    andWhere(
        where:
            | Brackets
            | string
            | ((qb: this) => string)
            | ObjectLiteral
            | ObjectLiteral[],
        parameters?: ObjectLiteral,
    ): this {
        this.expressionMap.wheres.push({
            type: "and",
            condition: this.getWhereCondition(where),
        })
        if (parameters) this.setParameters(parameters)
        return this
    }

    /**
     * Adds new OR WHERE condition in the query builder.
     * Additionally you can add parameters used in where expression.
     */
    orWhere(
        where:
            | Brackets
            | string
            | ((qb: this) => string)
            | ObjectLiteral
            | ObjectLiteral[],
        parameters?: ObjectLiteral,
    ): this {
        this.expressionMap.wheres.push({
            type: "or",
            condition: this.getWhereCondition(where),
        })
        if (parameters) this.setParameters(parameters)
        return this
    }

    /**
     * Sets WHERE condition in the query builder with a condition for the given ids.
     * If you had previously WHERE expression defined,
     * calling this function will override previously set WHERE conditions.
     */
    whereInIds(ids: any | any[]): this {
        return this.where(this.getWhereInIdsCondition(ids))
    }

    /**
     * Adds new AND WHERE with conditions for the given ids.
     */
    andWhereInIds(ids: any | any[]): this {
        return this.andWhere(this.getWhereInIdsCondition(ids))
    }

    /**
     * Adds new OR WHERE with conditions for the given ids.
     */
    orWhereInIds(ids: any | any[]): this {
        return this.orWhere(this.getWhereInIdsCondition(ids))
    }
    /**
     * Optional returning/output clause.
     * This will return given column values.
     */
    output(columns: string[]): this

    /**
     * Optional returning/output clause.
     * Returning is a SQL string containing returning statement.
     */
    output(output: string): this

    /**
     * Optional returning/output clause.
     */
    output(output: string | string[]): this

    /**
     * Optional returning/output clause.
     */
    output(output: string | string[]): this {
        return this.returning(output)
    }

    /**
     * Optional returning/output clause.
     * This will return given column values.
     */
    returning(columns: string[]): this

    /**
     * Optional returning/output clause.
     * Returning is a SQL string containing returning statement.
     */
    returning(returning: string): this

    /**
     * Optional returning/output clause.
     */
    returning(returning: string | string[]): this

    /**
     * Optional returning/output clause.
     */
    returning(returning: string | string[]): this {
        // not all databases support returning/output cause
        if (!this.connection.driver.isReturningSqlSupported("delete")) {
            throw new ReturningStatementNotSupportedError()
        }

        this.expressionMap.returning = returning
        return this
    }

    // -------------------------------------------------------------------------
    // Protected Methods
    // -------------------------------------------------------------------------

    /**
     * Creates DELETE express used to perform query.
     */
    protected createDeleteExpression() {
        const tableName = this.getTableName(this.getMainTableName())
        const whereExpression = this.createWhereExpression()
        const returningExpression = this.createReturningExpression("delete")

        if (returningExpression === "") {
            return `DELETE FROM ${tableName}${whereExpression}`
        }
        if (this.connection.driver.options.type === "mssql") {
            return `DELETE FROM ${tableName} OUTPUT ${returningExpression}${whereExpression}`
        }
        return `DELETE FROM ${tableName}${whereExpression} RETURNING ${returningExpression}`
    }
}
