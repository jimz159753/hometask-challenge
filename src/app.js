const express = require('express');
const bodyParser = require('body-parser');
const {sequelize} = require('./model')
const {getProfile} = require('./middleware/getProfile');
const {Sequelize, Op, where} = require('sequelize');

const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

app.get('/contracts/:id',getProfile ,async (req, res) =>{
    const {Contract} = req.app.get('models')
    const {id} = req.params
    const contract = await Contract.findOne({where: {id}})
    if(!contract) return res.status(404).end()
    res.json(contract)
})

app.get('/contracts',getProfile ,async (req, res) =>{
    const {Contract} = req.app.get('models')
    const contracts = await Contract.findAll()
    if(!contracts) return res.status(404).end()
    res.json(contracts)
})

app.get('/jobs/unpaid',getProfile ,async (req, res) =>{
    const {Contract, Job} = req.app.get('models')
    const contracts = await Contract.findAll({ 
        where: {
            status: {
                [Op.not]: 'terminated'
            }
        },
        include: [
            {
                model: Job,
                where: {
                    paid: null
                }
            }
        ]
    })
    if(!contracts) return res.status(404).end()
    const jobs = contracts.flatMap(contract => contract.Jobs)
    res.json(jobs)
})

app.get('/jobs/:job_id/pay',getProfile ,async (req, res) =>{
    const jobId = req.params.job_id
    const {Profile, Job, Contract} = req.app.get('models')
    const client = await Profile.findOne({
        where: {id: req.get('profile_id')}, 
        raw: true, 
        nest: true
    })
    const job = await Job.findOne({ 
        where: { id: jobId}, 
        raw: true, 
        nest: true
    })

    if(client.balance >= job.price && !job.paid) {
        // DECREMENT THE BALANCE OF THE CLIENT
        await Profile.decrement('balance', { 
            by: job.price, 
            where: { id: req.get('profile_id')}
        })
        // LOOK FOR A CONTRACT BY ID
        const contract = await Contract.findOne({ 
            where: { id: job.ContractId}, 
            raw: true, 
            nest: true
        })
        // INCREMENT THE BALANCE OF THE CONTRACTOR
        await Profile.increment('balance', {
            by: job.price,
            where: { id: contract.ContractorId }
        })
        // UPDATE THE STATUS OF THE JOB TO PAID
        await Job.update({ paid: true, paymentDate: new Date() }, { 
            where: { id: jobId}
        })
    }

    const jobUpdated = await Job.findOne({ 
        where: { id: jobId}
    })
    if(!jobUpdated) return res.status(404).end()
    res.json(jobUpdated)
})


module.exports = app;
